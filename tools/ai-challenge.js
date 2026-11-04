import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { isMainThread, parentPort } from 'node:worker_threads';
import { simulate, sourceHash, validateSimulationOptions, VERSIONS } from './ai-benchmark.js';
import { summarizeEvaluation } from './ai-evaluate.js';
import { cpuCapacity, runTournament, validateJobs } from './ai-pool.js';
import { PlayerProxy, PLAYER_POLICIES } from './player-proxy.js';
import { ReactivePlayerProxy, REACTIVE_PLAYER_POLICIES, REACTIVE_ADVERSARY_VERSION, REACTIVE_DEFAULTS } from './reactive-player-proxy.js';
import { DIRECTIONS, shotAt } from '../shared/ai/geometry.js';

export const CHALLENGE_ADVERSARIES = Object.freeze([...PLAYER_POLICIES.map(policy => `old:${policy}`), ...REACTIVE_PLAYER_POLICIES]);
export const CHALLENGE_MODES = Object.freeze(['objective', 'encounter', 'crossfire']);
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const mapsURL = new URL('../shared/maps/', import.meta.url);
const entry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

function uint32(seed, name) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw new Error(`${name} must be uint32`);
    return seed;
}

function distinct(values, name, valid) {
    if (!Array.isArray(values) || !values.length || values.some(value => !valid(value))) throw new Error(`Invalid ${name}`);
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${name}`);
    return [...values];
}

function adversarySeed(seed, descriptor) {
    let value = (seed ^ 0x811C9DC5) >>> 0;
    for (const letter of descriptor) value = Math.imul(value ^ letter.charCodeAt(0), 16777619) >>> 0;
    return value;
}

export function normalizeChallengeOptions(options = {}) {
    const mode = options.mode ?? 'encounter', adversary = options.adversary ?? 'reactive-dodge';
    if (!CHALLENGE_MODES.includes(mode)) throw new Error(`Unknown challenge mode: ${mode}`);
    if (!CHALLENGE_ADVERSARIES.includes(adversary)) throw new Error(`Unknown adversary: ${adversary}`);
    const candidateSide = options.candidateSide ?? 1;
    if (![1, 2].includes(candidateSide)) throw new Error('candidateSide must be 1 or 2');
    const objective = mode === 'objective', crossfire = mode === 'crossfire';
    const config = validateSimulationOptions({ ...options,
        versions: options.versions ?? { 1: 'tactical-v5', 2: 'tactical-v5' }, candidateSide,
        ticks: options.ticks ?? (objective ? 7200 : 3600), tanks: objective ? 4 : crossfire ? 2 : 1,
        reserve: objective ? 12 : crossfire ? 2 : 1, bases: objective, vibranium: objective,
        players: 1, playerSide: 3 - candidateSide, playerLives: objective ? 3 : 0,
        playerPolicy: adversary.startsWith('old:') ? adversary.slice(4) : 'duelist',
    });
    const seed = uint32(options.adversarySeed ?? adversarySeed(config.seed,
        `${config.map}:${adversary}:${config.playerLevel}:${config.reaction}`), 'adversarySeed');
    return { ...config, mode, adversary, adversarySeed: seed,
        initialReserves: { [candidateSide]: config.reserve, [3 - candidateSide]: crossfire ? 0 : config.reserve } };
}

function hasTwoAxes(lanes) {
    return lanes.some(a => lanes.some(b => a.id !== b.id && a.axis !== b.axis));
}

// This is a geometric opportunity metric at the observed post-update state,
// not a prediction that two shots will land or that the player cannot escape.
export function crossfireGeometry(room, candidateSide) {
    const player = Object.values(room.players).find(tank => tank.team !== candidateSide && tank.team > 0 && !tank.isDead && !tank.isSpawning);
    const bots = room.enemies.filter(tank => tank.team === candidateSide && !tank.isDead);
    if (!player || player.shieldTimer > 0 || bots.length < 2) return { pairActive: false, twoAxes: false, twoReadyAxes: false };
    const lanes = [];
    for (const bot of bots) for (const direction of Object.keys(DIRECTIONS)) {
        const shot = shotAt(room, bot, direction, player);
        if (shot && !shot.breach && shot.distance <= 144) lanes.push({ id: bot.id,
            axis: direction === 'UP' || direction === 'DOWN' ? 'vertical' : 'horizontal', ready: bot.bulletTimer <= 0 });
    }
    return { pairActive: true, twoAxes: hasTwoAxes(lanes), twoReadyAxes: hasTwoAxes(lanes.filter(lane => lane.ready)) };
}

export async function simulateChallenge(options = {}) {
    const config = normalizeChallengeOptions(options);
    const observations = { firstPlayerKillTick: null, firstCandidateLossTick: null, firstOwnBaseLossTick: null,
        candidateBotLosses: 0, proxyActiveTicks: 0, proxyVulnerableTicks: 0,
        pairActiveTicks: 0, twoAxisLineTicks: 0, twoAxisReadyTicks: 0, yieldInterruptions: null };
    const created = [];
    const game = await simulate(config, {
        configureRoom(room) { room.settings.botsReserve = { ...config.initialReserves }; },
        createPlayerProxy(room, id, proxyOptions) {
            const proxy = config.adversary.startsWith('old:')
                ? new PlayerProxy(room, id, proxyOptions)
                : new ReactivePlayerProxy(room, id, { policy: config.adversary, seed: config.adversarySeed,
                    reaction: config.reaction });
            created.push(proxy);
            return proxy;
        },
        observeTick({ room, elapsed }) {
            for (const event of room.bulletEvents) {
                if (event.type === 'TANK_EXPLODE' && event.isPlayer && event.team === config.candidateSide) observations.firstPlayerKillTick ??= elapsed;
                if (event.type === 'TANK_EXPLODE' && !event.isPlayer && event.targetTeam === config.candidateSide) {
                    observations.firstCandidateLossTick ??= elapsed;
                    observations.candidateBotLosses++;
                }
                if (event.type === 'BASE_DESTROY' && event.targetTeam === config.candidateSide) observations.firstOwnBaseLossTick ??= elapsed;
            }
            const player = Object.values(room.players).find(tank => tank.team === config.playerSide);
            if (player && !player.isDead && !player.isSpawning) {
                observations.proxyActiveTicks++;
                if (player.shieldTimer <= 0) observations.proxyVulnerableTicks++;
            }
            const geometry = crossfireGeometry(room, config.candidateSide);
            if (geometry.pairActive) observations.pairActiveTicks++;
            if (geometry.twoAxes) observations.twoAxisLineTicks++;
            if (geometry.twoReadyAxes) observations.twoAxisReadyTicks++;
            const controller = room.botAIs[config.versions[config.candidateSide]];
            if (Number.isSafeInteger(controller?.yieldInterruptions)) observations.yieldInterruptions = controller.yieldInterruptions;
        },
    });
    return { ...game, challengeOptions: config, observations,
        adversaryDiagnostics: created.map(proxy => proxy.diagnostics?.() ?? {
            version: 'frozen-player-proxy', policy: config.playerPolicy,
        }) };
}

export function buildChallengePlan({ candidates = ['tactical-v5'], reference = 'tactical-v5', opponent = 'tactical-v5',
    suite = 'quick', maps, seeds, adversaries, modes = CHALLENGE_MODES, levels, reactions, ticks } = {}) {
    if (!['quick', 'full'].includes(suite)) throw new Error(`Unknown challenge suite: ${suite}`);
    candidates = distinct(candidates, 'candidates', version => VERSIONS.includes(version));
    if (!VERSIONS.includes(reference) || !VERSIONS.includes(opponent)) throw new Error('Reference and opponent must be registered policies');
    maps = distinct(maps ?? (suite === 'quick' ? ['1'] : ['The_Void', 'Bunker', '1']), 'maps', map => typeof map === 'string' && map.trim());
    seeds = distinct(seeds ?? (suite === 'quick' ? [6007] : [6011, 6037, 6049]), 'seeds', seed => Number.isInteger(seed) && seed >= 0 && seed <= 0xFFFFFFFF);
    adversaries = distinct(adversaries ?? (suite === 'quick' ? ['old:duelist', 'reactive-dodge', 'switch-rush'] : CHALLENGE_ADVERSARIES),
        'adversaries', value => CHALLENGE_ADVERSARIES.includes(value));
    modes = distinct(modes, 'modes', mode => CHALLENGE_MODES.includes(mode));
    levels = distinct(levels ?? (suite === 'quick' ? [4] : [1, 4]), 'levels', level => [1, 2, 3, 4].includes(level));
    reactions = distinct(reactions ?? (suite === 'quick' ? [6] : [3, 6, 12]), 'reactions', reaction => Number.isSafeInteger(reaction) && reaction > 0);
    if (ticks !== undefined && (!Number.isSafeInteger(ticks) || ticks < 1)) throw new Error('ticks must be a positive integer');
    const cells = [], tasks = [];
    for (const mode of modes) for (const adversary of adversaries) for (const playerLevel of levels) for (const reaction of reactions) {
        const id = `${mode}:${adversary}:level${playerLevel}:reaction${reaction}`;
        const cell = { id, mode, kind: mode === 'objective' ? 'player' : 'encounter', adversary,
            scoreBasis: mode === 'objective' ? 'team-game' : 'proxy-destruction', opponent,
            options: { mode, adversary, playerLevel, reaction, ticks: ticks ?? (suite === 'quick' ? 1200 : mode === 'objective' ? 7200 : 3600) } };
        cells.push(cell);
        for (const map of maps) for (const seed of seeds) for (const side of [1, 2]) {
            for (const [arm, version] of [...candidates.map(version => ['candidate', version]), ['reference', reference]]) {
                const options = normalizeChallengeOptions({ ...cell.options, map, seed, candidateSide: side,
                    versions: { [side]: version, [3 - side]: opponent } });
                tasks.push({ index: tasks.length, cellId: id, arm, version, options });
            }
        }
    }
    return { config: { candidates, reference, opponent, suite, maps, seeds, adversaries, modes, levels, reactions, ticks: ticks ?? null }, cells, tasks };
}

function observationSummary(games) {
    const killed = games.filter(game => game.observations.firstPlayerKillTick !== null);
    return { proxyDestructions: killed.length, censored: games.length - killed.length,
        meanKillTickWhenDestroyed: killed.length ? mean(killed.map(game => game.observations.firstPlayerKillTick)) : null,
        meanCandidateBotLosses: mean(games.map(game => game.observations.candidateBotLosses)),
        pairActiveTicks: games.reduce((sum, game) => sum + game.observations.pairActiveTicks, 0),
        twoAxisLineTicks: games.reduce((sum, game) => sum + game.observations.twoAxisLineTicks, 0),
        twoAxisReadyTicks: games.reduce((sum, game) => sum + game.observations.twoAxisReadyTicks, 0) };
}

export function summarizeChallenges(plan, games) {
    if (games.length !== plan.tasks.length) throw new Error('Challenge result count differs from plan');
    const comparisons = {};
    for (const candidate of plan.config.candidates) {
        const selected = plan.tasks.filter(task => task.arm === 'reference' || task.version === candidate && task.arm === 'candidate');
        const evaluation = summarizeEvaluation({ config: { ...plan.config, candidate }, cells: plan.cells, tasks: selected }, selected.map(task => games[task.index]));
        for (const cell of evaluation.cells) {
            for (const sample of cell.paired.samples) for (const side of sample.sides) {
                side.candidateIndex = selected[side.candidateIndex].index;
                side.referenceIndex = selected[side.referenceIndex].index;
            }
            for (const arm of ['candidate', 'reference']) {
                const matching = selected.filter(task => task.cellId === cell.id && task.arm === arm).map(task => games[task.index]);
                cell.arms[arm].observations = observationSummary(matching);
            }
        }
        const summary = Object.fromEntries(plan.config.modes.map(mode => {
            const cells = evaluation.cells.filter(cell => cell.mode === mode);
            return [mode, { scoreBasis: cells[0].scoreBasis, cells: cells.length,
                candidateScore: mean(cells.map(cell => cell.arms.candidate.score)), referenceScore: mean(cells.map(cell => cell.arms.reference.score)),
                meanDelta: mean(cells.map(cell => cell.paired.meanDelta)),
                pairedMapSeedUnits: cells.reduce((sum, cell) => sum + cell.paired.count, 0) }];
        }));
        comparisons[candidate] = { summary, cells: evaluation.cells };
    }
    return { comparisons, games: plan.tasks.map(task => ({ ...task, game: games[task.index] })) };
}

async function challengeHashes() {
    const files = ['tools/ai-challenge.js', 'tools/reactive-player-proxy.js', 'tools/player-proxy.js'];
    const [engineSourceHash, ...contents] = await Promise.all([sourceHash(), ...files.map(file => readFile(new URL(`../${file}`, import.meta.url)))]);
    const [harnessHash, adversaryHash, frozenProxyHash] = contents.map(content => createHash('sha256').update(content).digest('hex'));
    return { sourceHash: engineSourceHash, harnessHash, adversaryHash, frozenProxyHash,
        challengeSourceHash: createHash('sha256').update([engineSourceHash, harnessHash, adversaryHash, frozenProxyHash].join(':')).digest('hex') };
}

export async function runChallenges({ jobs, onProgress, ...options } = {}) {
    const maps = options.maps === 'all' ? (await readdir(mapsURL)).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)).sort()
        : typeof options.maps === 'string' ? options.maps.split(',').map(value => value.trim()) : options.maps;
    const plan = buildChallengePlan({ ...options, maps });
    if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function');
    const capacity = cpuCapacity(), requestedJobs = jobs === undefined ? capacity.defaultJobs : validateJobs(jobs);
    const hashes = await challengeHashes();
    const started = performance.now();
    const games = await runTournament(plan.tasks.map(task => task.options), { jobs: requestedJobs,
        workerURL: new URL('./ai-challenge.js', import.meta.url),
        onProgress: event => onProgress?.({ ...event, challengeTask: plan.tasks[event.index] }) });
    const totalMs = performance.now() - started;
    return { formatVersion: 1, config: plan.config, ...hashes, node: process.version,
        adversaryVersion: REACTIVE_ADVERSARY_VERSION, reactiveDefaults: REACTIVE_DEFAULTS,
        methodology: {
            engine: 'Shared ai-benchmark.simulate with synchronous fixture/proxy/observer hooks; no copied physics or simulation loop.',
            adversaries: 'Frozen old proxies or separately versioned input-only adversaries, with a private seeded RNG independent of every candidate.',
            timing: 'Reaction delay starts when an existing enemy projectile is first observed by the proxy; no future enemy inputs are read.',
            pairing: 'Same map, seed, side, profile and adversary seed; sides averaged within map-seed; one shared reference arm reused across candidates.',
            inference: 'Descriptive deltas, no independent-match assumption or confidence interval; score bases remain separate.',
            encounters: 'Typed player destruction is separate from team victory. Ordinary encounter includes enemy bot reserve 1 after proxy death.',
            crossfire: 'Two candidate bot reserves versus one player and zero enemy bot reserve; normal spawn timing, bonuses and all engine rules still apply.',
            geometry: 'twoAxisLineTicks requires two distinct live bots with unblocked horizontal/vertical lanes within144px to a vulnerable proxy; opportunity only, not guaranteed impact.',
            initialLevel: 'Initial weapon level only; ordinary respawns/bonuses can change it. These scripts do not measure human skill.',
        }, execution: { backend: 'worker_threads', jobs: Math.min(requestedJobs, games.length), requestedJobs, ...capacity,
            timing: 'pool-throughput-including-contention-startup-and-cleanup', totalMs },
        ...summarizeChallenges(plan, games) };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        console.log('node tools/ai-challenge.js [--candidates tactical-v5,...] [--reference tactical-v5] [--opponent tactical-v5] [--suite quick|full] [--maps 1,7|all] [--seeds 6007,...] [--adversaries old:duelist,reactive-dodge,switch-rush,bait-corner] [--modes objective,encounter,crossfire] [--levels 1,4] [--reactions 3,6,12] [--ticks N] [--jobs N] [--output report.json]');
        return;
    }
    const lists = new Set(['candidates', 'seeds', 'adversaries', 'modes', 'levels', 'reactions']);
    const numbers = new Set(['ticks', 'jobs']);
    const allowed = new Set([...lists, ...numbers, 'reference', 'opponent', 'suite', 'maps', 'output']);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index].replace(/^--/, ''), value = args[index + 1];
        if (!args[index].startsWith('--') || !allowed.has(name) || !value || value.startsWith('--') || name in options) throw new Error(`Invalid option: ${args[index]}`);
        options[name] = lists.has(name) ? value.split(',').map(item => ['seeds', 'levels', 'reactions'].includes(name) ? item.trim() ? Number(item) : NaN : item.trim())
            : numbers.has(name) ? Number(value) : value;
    }
    const { output, ...config } = options;
    const report = await runChallenges({ ...config, onProgress: ({ completed, total, challengeTask: task }) => {
        if (completed === total || completed % Math.max(1, Math.floor(total / 100)) === 0) console.error(`[${completed}/${total}] ${task.cellId} ${task.arm}=${task.version} map=${task.options.map} seed=${task.options.seed} side=${task.options.candidateSide}`);
    } });
    if (output) { await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ output, comparisons: Object.fromEntries(Object.entries(report.comparisons).map(([version, comparison]) => [version, comparison.summary])) }, null, 2)); }
    else console.log(JSON.stringify(report, null, 2));
}

if (entry && !isMainThread && parentPort) {
    parentPort.on('message', async ({ id, config }) => {
        try { parentPort.postMessage({ id, result: await simulateChallenge(config) }); }
        catch (error) { parentPort.postMessage({ id, error: { name: error.name, message: error.message, stack: error.stack, code: error.code } }); }
    });
} else if (entry && isMainThread) main().catch(error => { console.error(error.message); process.exitCode = 1; });
