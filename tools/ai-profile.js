import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { GameRoom } from '../game_room.js';
import { BOT_VERSIONS, DEFAULT_BOT_VERSION } from '../shared/ai/versions.js';
import { cpuCapacity } from './ai-pool.js';

const root = new URL('../', import.meta.url);
const SEED = 1, FRAME_BUDGET_MS = 16.67;
const SCOPE = 'One room, serial updates, no socket/network sends. This does not measure multi-room capacity.';

function parseOptions(args) {
    const options = { version: DEFAULT_BOT_VERSION, maps: ['1', 'Bunker', 'The_Void'],
        ticks: 3600, warmup: 300, tanks: 6, players: 0 };
    const allowed = new Set(['version', 'maps', 'ticks', 'warmup', 'tanks', 'players', 'output']);
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        if (!args[i].startsWith('--') || !allowed.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
            throw new Error(`Invalid option: ${args[i]}. Use --help.`);
        }
        options[key] = args[i + 1];
    }
    if (!BOT_VERSIONS.includes(options.version)) throw new Error(`Version must be registered: ${BOT_VERSIONS.join(', ')}`);
    if (typeof options.maps === 'string') options.maps = options.maps.split(',');
    if (options.maps.some(map => !map || map === '.' || map === '..' || /[/\\]/.test(map))) throw new Error('Invalid map name');
    for (const key of ['ticks', 'warmup', 'tanks', 'players']) {
        options[key] = Number(options[key]);
        if (!Number.isSafeInteger(options[key]) || options[key] < (key === 'ticks' || key === 'tanks' ? 1 : 0)) {
            throw new Error(`${key} must be ${key === 'ticks' || key === 'tanks' ? 'a positive' : 'a nonnegative'} integer`);
        }
    }
    if (options.players > 1) throw new Error('players must be 0 or 1');
    return options;
}

async function sourceHash() {
    const files = ['game_room.js', 'battle_system.js', 'tools/ai-profile.js', 'tools/ai-pool.js'];
    async function collect(directory) {
        for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
            const path = `${directory}${entry.name}`;
            if (entry.isDirectory()) await collect(`${path}/`);
            else if (entry.name.endsWith('.js')) files.push(path);
        }
    }
    await collect('shared/');
    const hash = createHash('sha256');
    for (const file of files.sort()) hash.update(file).update('\0').update(await readFile(new URL(file, root))).update('\0');
    return hash.digest('hex');
}

const rounded = value => Math.round(value * 1e6) / 1e6;
function statistics(samples) {
    if (!samples.length) return { count: 0, meanMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null,
        overBudget: { thresholdMs: FRAME_BUDGET_MS, count: 0, fraction: null } };
    const sorted = [...samples].sort((a, b) => a - b);
    const percentile = fraction => rounded(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]);
    const over = samples.filter(sample => sample > FRAME_BUDGET_MS).length;
    return { count: samples.length, meanMs: rounded(samples.reduce((sum, sample) => sum + sample, 0) / samples.length),
        p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: rounded(sorted.at(-1)),
        overBudget: { thresholdMs: FRAME_BUDGET_MS, count: over, fraction: over / samples.length } };
}

function ordinaryInputs(tick) {
    // Generated outside the update timer. The real updatePlayer handles movement,
    // collisions, ammo, cooldown, respawning and upgrades; there is no proxy AI.
    const direction = ['up', 'left', 'up', 'right', 'down', 'right', 'down', 'left'][Math.floor(tick / 90) % 8];
    return { up: direction === 'up', down: direction === 'down', left: direction === 'left',
        right: direction === 'right', fire: tick % 120 < 100, cheat0: false };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        console.log(`node tools/ai-profile.js [--version ${DEFAULT_BOT_VERSION}] [--maps 1,Bunker,The_Void] [--ticks 3600] [--warmup 300] [--tanks 6] [--players 0|1] [--output report.json]
Registered versions: ${BOT_VERSIONS.join(', ')}
${SCOPE}
Each map gets --warmup excluded updates followed by --ticks measured updates.
The very first update is recorded separately as cold and excluded from both.
One GameRoom is reused in map order, seed=1, reserve=20/team. Game-over resets
are timed separately. Player=1 uses ordinary deterministic inputs, no proxy AI.
Only GameRoom.update() is inside the update timer; input generation, setup,
map loading, resets and report generation are outside. Quantiles use nearest rank.
Run on an otherwise idle host for useful 60fps regression comparisons.`);
        return;
    }
    const options = parseOptions(args);
    const setup = {};
    let start = performance.now();
    const hash = await sourceHash();
    setup.sourceHashMs = rounded(performance.now() - start);
    start = performance.now();
    const maps = [];
    for (const map of options.maps) {
        const data = await readFile(new URL(`shared/maps/${encodeURIComponent(map)}.json`, root), 'utf8');
        maps.push({ name: map, data: JSON.parse(data), hash: createHash('sha256').update(data).digest('hex') });
    }
    setup.mapLoadMs = rounded(performance.now() - start);
    const capacity = cpuCapacity();
    start = performance.now();
    const room = new GameRoom('PROFILE', null, [], { seed: SEED, silent: true });
    setup.roomCreateMs = rounded(performance.now() - start); // Includes constructor's default-map reset.
    room.settings = { ...room.settings, botVersion: options.version,
        botVersions: { 1: options.version, 2: options.version },
        maxActiveTanks: options.tanks, botsReserve: { 1: 20, 2: 20 },
        basesEnabled: true, vibraniumBase: true, autoNextLevel: false, startLives: 4 };
    start = performance.now();
    if (options.players) {
        room.addPlayer('PROFILE', 0, 'Profile input');
        room.players.PROFILE_0.team = 1;
    }
    setup.playerCreateMs = rounded(performance.now() - start);
    const allUpdates = [], allResets = [], results = [];
    let cold = null, totalUpdateCalls = 0;
    for (const map of maps) {
        start = performance.now();
        room.settings.level = map.name;
        room.rawMapData = map.data;
        room.resetGame();
        const mapSetupMs = rounded(performance.now() - start);
        const updates = [], warmup = [], resets = [], resetsByPhase = { cold: 0, warmup: 0, measured: 0 };
        let inputTick = 0, activeBotsSum = 0, activeBotsMax = 0, activeBotsMin = Infinity;
        const step = phase => {
            if (room.isGameOver) {
                const beforeReset = performance.now();
                room.resetGame();
                const resetMs = performance.now() - beforeReset;
                resets.push(resetMs);
                allResets.push(resetMs);
                resetsByPhase[phase]++;
            }
            if (options.players) room.players.PROFILE_0.inputs = ordinaryInputs(inputTick);
            inputTick++;
            const beforeUpdate = performance.now();
            room.update();
            const updateMs = performance.now() - beforeUpdate;
            totalUpdateCalls++;
            if (phase === 'measured') {
                activeBotsSum += room.enemies.length;
                activeBotsMin = Math.min(activeBotsMin, room.enemies.length);
                activeBotsMax = Math.max(activeBotsMax, room.enemies.length);
            }
            return updateMs;
        };
        let coldUpdates = 0;
        if (!cold) {
            cold = { map: map.name, firstUpdateMs: rounded(step('cold')) };
            coldUpdates = 1;
        }
        for (let tick = 0; tick < options.warmup; tick++) warmup.push(step('warmup'));
        for (let tick = 0; tick < options.ticks; tick++) {
            const updateMs = step('measured');
            updates.push(updateMs);
            allUpdates.push(updateMs);
        }
        results.push({ map: map.name, mapHash: map.hash, mapSetupMs,
            updateCalls: { cold: coldUpdates, warmup: warmup.length, measured: updates.length,
                total: coldUpdates + warmup.length + updates.length },
            update: statistics(updates), warmup: statistics(warmup),
            resets: { ...statistics(resets), byPhase: resetsByPhase },
            activeBots: { mean: rounded(activeBotsSum / updates.length), min: activeBotsMin, max: activeBotsMax } });
    }
    const report = { sourceHash: hash, node: process.version, cpuCapacity: capacity, scope: SCOPE,
        execution: { rooms: 1, workers: 0, networkSends: false },
        config: { ...options, seed: SEED, reservePerTeam: 20, bases: true, vibranium: true,
            playerTeam: options.players ? 1 : null, playerInputs: options.players ? 'cardinal cycle, fire 100/120 ticks, no cheats' : null },
        timing: 'Wall-clock milliseconds around GameRoom.update() only. Cold, warmup, setup and resets excluded from measured update statistics.',
        quantiles: 'nearest rank', setup, cold, totalUpdateCalls,
        update: statistics(allUpdates), resets: statistics(allResets), maps: results };
    const output = JSON.stringify(report, null, 2) + '\n';
    if (options.output) await writeFile(options.output, output);
    process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
