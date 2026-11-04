import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { runTournament, sourceHash, summarize, VERSIONS } from './ai-benchmark.js';
import { cpuCapacity, validateJobs } from './ai-pool.js';
import { DEFAULT_BOT_VERSION } from '../shared/ai/versions.js';

const mapsURL = new URL('../shared/maps/', import.meta.url);
const releaseMaps = ['1', '7', '15', 'Bunker', 'The_Void'];
const releaseSeeds = [1009, 2003, 3001];
const suites = ['quick', 'release', 'player', 'encounter'];
const arms = ['candidate', 'reference'];
const mean = values => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;

function profiles() {
    return ['evasive', 'duelist', 'rusher'].flatMap(playerPolicy => [1, 4].flatMap(playerLevel =>
        [3, 6, 12].map(reaction => ({ playerPolicy, playerLevel, reaction }))));
}

function makeCell(kind, opponent, profile = {}, ticks) {
    const encounter = kind === 'encounter';
    const id = kind === 'bots' ? `bots:${opponent}`
        : `${kind}:${profile.playerPolicy}:level${profile.playerLevel}:reaction${profile.reaction}`;
    return { id, kind, opponent, scoreBasis: encounter ? 'proxy-destruction' : 'team-game', options: {
        ticks: ticks ?? (encounter ? 3600 : 7200), tanks: encounter ? 1 : 4,
        reserve: encounter ? 1 : 12, bases: !encounter, vibranium: !encounter,
        players: kind === 'bots' ? 0 : 1, playerLives: encounter ? 0 : 3,
        playerPolicy: 'evasive', playerLevel: 4, reaction: 6, ...profile,
    } };
}

function uniqueArray(values, name, valid) {
    if (!Array.isArray(values) || !values.length || values.some(value => !valid(value))) throw new Error(`Invalid ${name}`);
    if (new Set(values).size !== values.length) throw new Error(`${name} must not contain duplicates`);
    return [...values];
}

// An arm changes only the evaluated policy. Its opponent, proxy profile, map,
// seed and candidate side are fixed across candidate/reference comparisons.
export function buildEvaluationPlan({ candidate = DEFAULT_BOT_VERSION, reference = 'tactical-v2', opponent = 'tactical-v1',
    suite = 'quick', maps, seeds, ticks } = {}) {
    if (!suites.includes(suite)) throw new Error(`Unknown suite: ${suite}`);
    for (const [name, version] of Object.entries({ candidate, reference, opponent })) {
        if (!VERSIONS.includes(version)) throw new Error(`Unknown ${name} policy: ${version}`);
    }
    if (ticks !== undefined && (!Number.isSafeInteger(ticks) || ticks < 1)) throw new Error('ticks must be a positive integer');
    maps = uniqueArray(maps ?? (suite === 'quick' ? ['1', '7'] : releaseMaps), 'maps', map => typeof map === 'string' && map.trim().length > 0);
    seeds = uniqueArray(seeds ?? (suite === 'quick' ? [11, 23] : releaseSeeds), 'seeds', seed => Number.isInteger(seed) && seed >= 0 && seed <= 0xFFFFFFFF);
    const cells = [];
    if (suite === 'quick') {
        const limit = ticks ?? 1800;
        cells.push(makeCell('bots', opponent, {}, limit),
            makeCell('player', opponent, { playerPolicy: 'duelist', playerLevel: 4, reaction: 6 }, limit),
            makeCell('encounter', opponent, { playerPolicy: 'evasive', playerLevel: 1, reaction: 12 }, limit));
    } else {
        if (suite === 'release') {
            for (const version of new Set([opponent, 'tactical-v1', 'tactical-v2'])) cells.push(makeCell('bots', version, {}, ticks));
        }
        for (const kind of suite === 'release' ? ['player', 'encounter'] : [suite]) {
            for (const profile of profiles()) cells.push(makeCell(kind, opponent, profile, ticks));
        }
    }
    const tasks = [];
    for (const cell of cells) for (const map of maps) for (const seed of seeds) for (const side of [1, 2]) {
        for (const arm of arms) {
            const version = arm === 'candidate' ? candidate : reference;
            tasks.push({ index: tasks.length, cellId: cell.id, arm, version, options: {
                ...cell.options, map, seed, candidateSide: side, playerSide: 3 - side,
                versions: { [side]: version, [3 - side]: cell.opponent },
            } });
        }
    }
    return { config: { candidate, reference, opponent, suite, maps, seeds, ticks: ticks ?? null }, cells, tasks };
}

function teamResult(game) {
    if (game.ending === 'timeout') return 'timeout';
    return game.winner ? (game.winner === game.candidateSide ? 'win' : 'loss') : 'draw';
}

export function gradeGame(game, cell) {
    if (![1, 2].includes(game.candidateSide)) throw new Error('Evaluation games require explicit candidateSide');
    if (!['victory', 'draw', 'timeout'].includes(game.ending)
        || (game.ending === 'victory' ? ![1, 2].includes(game.winner) : game.winner !== null)) {
        throw new Error('Evaluation game has an inconsistent team outcome');
    }
    const result = teamResult(game);
    if (cell.scoreBasis === 'proxy-destruction') {
        const kills = game.metrics[game.candidateSide]?.playerKills;
        if (!Number.isSafeInteger(kills) || kills < 0) throw new Error('Encounter grading requires typed playerKills');
        return { score: kills > 0 ? 1 : 0, result: kills > 0 ? 'proxy-destroyed' : 'proxy-not-destroyed', teamResult: result };
    }
    if (cell.scoreBasis !== 'team-game') throw new Error(`Unknown score basis: ${cell.scoreBasis}`);
    return { score: result === 'win' ? 1 : result === 'loss' ? 0 : 0.5, result, teamResult: result };
}

function armSummary(records, cell, version) {
    const games = records.map(record => record.game);
    const teamGame = summarize(games, version);
    teamGame.completedDraws = teamGame.draws - teamGame.timeouts;
    const grades = games.map(game => gradeGame(game, cell));
    return { version, games: games.length, scoreBasis: cell.scoreBasis, score: mean(grades.map(grade => grade.score)),
        proxyDestructionGames: games.filter(game => game.metrics[game.candidateSide].playerKills > 0).length, teamGame };
}

function pairedSummary(records, cell, maps, seeds) {
    const slots = new Map(records.map(record => [JSON.stringify([record.game.map, record.game.seed, record.game.candidateSide, record.arm]), record]));
    if (slots.size !== records.length) throw new Error(`Duplicate paired result in ${cell.id}`);
    const samples = [];
    for (const map of maps) for (const seed of seeds) {
        const sides = [];
        for (const candidateSide of [1, 2]) {
            const candidate = slots.get(JSON.stringify([map, seed, candidateSide, 'candidate']));
            const reference = slots.get(JSON.stringify([map, seed, candidateSide, 'reference']));
            if (!candidate || !reference) throw new Error(`Missing paired result in ${cell.id}`);
            if (candidate.game.mapHash !== reference.game.mapHash) throw new Error(`Paired map source differs in ${cell.id}`);
            const a = gradeGame(candidate.game, cell), b = gradeGame(reference.game, cell);
            sides.push({ candidateSide, candidateIndex: candidate.index, referenceIndex: reference.index,
                candidateScore: a.score, referenceScore: b.score, delta: a.score - b.score,
                candidateResult: a.result, referenceResult: b.result });
        }
        samples.push({ map, seed, candidateScore: mean(sides.map(side => side.candidateScore)),
            referenceScore: mean(sides.map(side => side.referenceScore)), delta: mean(sides.map(side => side.delta)), sides });
    }
    return { unit: 'map-seed-with-mirrored-sides', count: samples.length,
        candidateScore: mean(samples.map(sample => sample.candidateScore)), referenceScore: mean(samples.map(sample => sample.referenceScore)),
        meanDelta: mean(samples.map(sample => sample.delta)), improved: samples.filter(sample => sample.delta > 0).length,
        tied: samples.filter(sample => sample.delta === 0).length, regressed: samples.filter(sample => sample.delta < 0).length, samples };
}

export function summarizeEvaluation(plan, results) {
    if (results.length !== plan.tasks.length) throw new Error('Evaluation result count differs from its plan');
    const records = results.map((game, index) => {
        const task = plan.tasks[index], expected = task.options;
        if (game.map !== expected.map || game.seed !== expected.seed || game.candidateSide !== expected.candidateSide
            || [1, 2].some(side => game.versions?.[side] !== expected.versions[side])
            || game.playerSide !== (expected.players ? expected.playerSide : null)) {
            throw new Error(`Evaluation result does not match task ${index}`);
        }
        return { index, cellId: task.cellId, arm: task.arm, version: task.version, game };
    });
    const cells = plan.cells.map(cell => {
        const matching = records.filter(record => record.cellId === cell.id);
        return { ...cell, arms: Object.fromEntries(arms.map(arm => [arm,
            armSummary(matching.filter(record => record.arm === arm), cell, plan.config[arm])])),
        paired: pairedSummary(matching, cell, plan.config.maps, plan.config.seeds) };
    });
    const summary = {};
    for (const kind of ['bots', 'player', 'encounter']) {
        const matching = cells.filter(cell => cell.kind === kind);
        if (!matching.length) continue;
        summary[kind] = { scoreBasis: matching[0].scoreBasis, cells: matching.length,
            gamesPerArm: matching.reduce((total, cell) => total + cell.arms.candidate.games, 0),
            pairedMapSeedUnits: matching.reduce((total, cell) => total + cell.paired.count, 0),
            weighting: 'equal cells; mirrored sides averaged within each map-seed',
            candidateScore: mean(matching.map(cell => cell.arms.candidate.score)),
            referenceScore: mean(matching.map(cell => cell.arms.reference.score)),
            meanDelta: mean(matching.map(cell => cell.paired.meanDelta)) };
    }
    return { summary, cells, games: records };
}

async function resolveMaps(maps) {
    if (maps === 'all') return (await readdir(mapsURL)).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)).sort();
    return typeof maps === 'string' ? maps.split(',').map(map => map.trim()) : maps;
}

export async function runEvaluation({ jobs, onProgress, ...options } = {}) {
    if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function');
    const plan = buildEvaluationPlan({ ...options, maps: await resolveMaps(options.maps),
        seeds: typeof options.seeds === 'string' ? options.seeds.split(',').map(value => value.trim() ? Number(value) : NaN) : options.seeds });
    const capacity = cpuCapacity();
    const requestedJobs = jobs === undefined ? capacity.defaultJobs : validateJobs(jobs);
    const [hash, evaluatorSource] = await Promise.all([sourceHash(), readFile(new URL('./ai-evaluate.js', import.meta.url))]);
    const started = performance.now();
    const results = await runTournament(plan.tasks.map(task => task.options), {
        jobs: requestedJobs,
        onProgress: event => onProgress?.({ ...event, evaluationTask: plan.tasks[event.index] }),
    });
    const totalMs = performance.now() - started;
    return { formatVersion: 1, config: plan.config, sourceHash: hash,
        evaluatorHash: createHash('sha256').update(evaluatorSource).digest('hex'), node: process.version,
        methodology: {
            arms: 'Candidate and reference face the same fixed opponents, not one another.',
            pairing: 'Same cell, map, seed and candidate side; mirrored sides are averaged into map-seed units before deltas are summarized.',
            uncertainty: 'Descriptive deltas only; no independent-match assumption or confidence interval.',
            objectiveScore: 'Team win=1, loss=0, completed draw=0.5, timeout=0.5; timeouts are reported separately.',
            encounterScore: 'At least one typed player kill=1, otherwise=0, independent of team victory or timeout.',
            initialPlayerLevel: 'Initial only: bonuses can change level, and ordinary respawns reset it to level 1.',
            proxies: 'Fixed scripted input opponents; these scenarios do not measure human skill.',
            performance: 'Pool throughput only. Raw per-match wall timings include contention; hardware latency requires a separate benchmark.',
        },
        execution: { backend: 'worker_threads', jobs: Math.min(requestedJobs, plan.tasks.length), requestedJobs, ...capacity,
            timing: 'pool-wall-clock-including-startup-and-cleanup', totalMs, gamesPerSecond: results.length * 1000 / totalMs },
        ...summarizeEvaluation(plan, results) };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        console.log(`node tools/ai-evaluate.js [--candidate ${DEFAULT_BOT_VERSION}] [--reference tactical-v2] [--opponent tactical-v1] [--suite quick|release|player|encounter] [--maps 1,7|all] [--seeds 1009,2003,3001] [--ticks N] [--jobs N] [--output report.json]\nQuick defaults: 48 games, 1800 ticks. Release defaults: 2280 games across 38 cells, with 7200 objective / 3600 encounter ticks. Player and encounter suites each cover all 18 fixed profiles. Progress goes to stderr; without --output the complete report goes to stdout.`);
        return;
    }
    const allowed = new Set(['candidate', 'reference', 'opponent', 'suite', 'maps', 'seeds', 'ticks', 'jobs', 'output']);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index].replace(/^--/, '');
        if (!args[index].startsWith('--') || !allowed.has(name) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Invalid option: ${args[index]}`);
        if (name in options) throw new Error(`Duplicate option: --${name}`);
        options[name] = ['ticks', 'jobs'].includes(name) ? Number(args[index + 1]) : args[index + 1];
    }
    const { output, ...config } = options;
    const report = await runEvaluation({ ...config, onProgress: ({ completed, total, evaluationTask: task, result }) => {
        if (completed !== total && completed % Math.max(1, Math.floor(total / 100)) !== 0) return;
        console.error(`[${completed}/${total}] ${task.cellId} ${task.arm}=${task.version} map=${result.map} seed=${result.seed} side=${result.candidateSide} ${result.ending}`);
    } });
    if (output) {
        await writeFile(output, JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({ output, summary: report.summary }, null, 2));
    } else console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
