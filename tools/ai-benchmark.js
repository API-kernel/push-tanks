import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { GameRoom } from '../game_room.js';
import { SERVER_FPS, TANK_STATS } from '../shared/config.js';
import { PlayerProxy, PLAYER_POLICIES } from './player-proxy.js';
import { cpuCapacity, runTournament, validateJobs } from './ai-pool.js';

export { runTournament } from './ai-pool.js';

import { BOT_VERSIONS as VERSIONS } from '../shared/ai/versions.js';
export { VERSIONS };
const mapsURL = new URL('../shared/maps/', import.meta.url);

export async function simulate({ map = '1', seed = 1, versions = { 1: 'tactical-v2', 2: 'tactical-v1' }, ticks = 7200, tanks = 4, reserve = 12, bases = true, vibranium = true, players = 0, playerSide = 2, playerPolicy = 'evasive', playerLevel = 4, playerLives = 4, reaction = 6 }) {
    const mapText = await readFile(new URL(`${encodeURIComponent(map)}.json`, mapsURL), 'utf8');
    const rawMap = JSON.parse(mapText);
    const mapHash = createHash('sha256').update(mapText).digest('hex');
    const room = new GameRoom('BENCH', null, [], { seed, silent: true });
    room.settings = { ...room.settings, level: map, botVersions: versions,
        maxActiveTanks: tanks, botsReserve: { 1: reserve, 2: reserve }, basesEnabled: bases, vibraniumBase: vibranium };
    room.rawMapData = rawMap;
    room.resetGame();
    const proxies = [];
    if (players > 0) {
        room.settings.startLives = playerLives;
        for (let index = 0; index < players; index++) {
            room.addPlayer('PROXY', index, `Proxy ${index + 1}`);
            room.players[`PROXY_${index}`].team = playerSide;
        }
        room.resetGame();
        for (const player of Object.values(room.players)) {
            player.level = playerLevel;
            player.hp = TANK_STATS.player.levels[playerLevel].hp;
            proxies.push(new PlayerProxy(room, player.id, { policy: playerPolicy, reaction }));
        }
    }
    const metrics = { 1: { kills: 0, hits: 0, shots: 0, bonuses: 0, baseKills: 0 }, 2: { kills: 0, hits: 0, shots: 0, bonuses: 0, baseKills: 0 } };
    const started = performance.now();
    let elapsed = 0;
    let worstTickMs = 0;
    let updateMs = 0;
    const stateHash = createHash('sha256');
    while (elapsed < ticks && !room.isGameOver) {
        const before = performance.now();
        for (const proxy of proxies) room.players[proxy.id].inputs = proxy.decide();
        room.update();
        const tickMs = performance.now() - before;
        worstTickMs = Math.max(worstTickMs, tickMs);
        updateMs += tickMs;
        elapsed++;
        for (const event of room.bulletEvents) {
            const m = metrics[event.team || room.players[event.ownerId]?.team];
            if (!m) continue;
            if (event.type === 'TANK_EXPLODE') m.kills++;
            if (event.type === 'TANK_HIT') m.hits++;
            if (event.type === 'ENEMY_FIRE' || event.type === 'PLAYER_FIRE') m.shots++;
            if (event.type === 'BONUS_TAKEN') m.bonuses++;
            if (event.type === 'BASE_DESTROY') m.baseKills++;
        }
        // Ignore wall-clock bonus IDs. Hash physical state throughout the game, not only its outcome.
        if (elapsed % 60 === 0 || elapsed === ticks || room.isGameOver) stateHash.update(JSON.stringify([room.enemies, Object.values(room.players), room.bullets,
            room.activeBonus && { x: room.activeBonus.x, y: room.activeBonus.y, type: room.activeBonus.type },
            room.botsSpawnedCount, room.map]));
    }
    return { map, mapHash, seed, versions, playerSide: players ? playerSide : null, winner: room.winnerTeamId,
        ending: room.isGameOver ? (room.winnerTeamId ? 'victory' : 'draw') : 'timeout',
        ticks: elapsed, gameSeconds: elapsed / SERVER_FPS, metrics,
        fingerprint: stateHash.digest('hex'),
        performance: { totalMs: performance.now() - started, updateMs, meanTickMs: updateMs / elapsed, worstTickMs } };
}

export function summarize(games, candidate) {
    const result = { games: games.length, wins: 0, losses: 0, draws: 0, timeouts: 0,
        candidateKills: 0, opponentKills: 0, candidateBonuses: 0, opponentBonuses: 0, candidateBaseKills: 0 };
    for (const game of games) {
        const side = Number(Object.keys(game.versions).find(t => game.versions[t] === candidate));
        if (game.winner === side) result.wins++;
        else if (game.winner) result.losses++;
        else result.draws++;
        if (game.ending === 'timeout') result.timeouts++;
        result.candidateKills += game.metrics[side].kills;
        result.opponentKills += game.metrics[3 - side].kills;
        result.candidateBonuses += game.metrics[side].bonuses;
        result.opponentBonuses += game.metrics[3 - side].bonuses;
        result.candidateBaseKills += game.metrics[side].baseKills;
    }
    result.score = games.length ? (result.wins + result.draws / 2) / games.length : 0;
    return result;
}

export async function sourceHash() {
    const files = ['game_room.js', 'battle_system.js', 'tools/ai-benchmark.js', 'tools/ai-pool.js', 'tools/ai-worker.js', 'tools/player-proxy.js'];
    for (const dir of ['shared', 'shared/ai']) {
        for (const file of await readdir(new URL(`../${dir}/`, import.meta.url))) {
            if (file.endsWith('.js')) files.push(`${dir}/${file}`);
        }
    }
    const hash = createHash('sha256');
    for (const file of files.sort()) hash.update(file).update(await readFile(new URL(`../${file}`, import.meta.url)));
    return hash.digest('hex');
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        console.log('node tools/ai-benchmark.js [--candidate tactical-v2] [--baseline tactical-v1] [--maps 1,7,Bunker|all] [--seeds 1,2,3] [--ticks 7200] [--tanks 4] [--reserve 12] [--bases false] [--vibranium false] [--players 0] [--player-policy evasive|duelist|rusher] [--player-level 4] [--player-lives 4] [--reaction 6] [--jobs N] [--output report.json]');
        return;
    }
    const allowed = new Set(['candidate', 'baseline', 'maps', 'seeds', 'ticks', 'tanks', 'reserve', 'bases', 'vibranium', 'output', 'players', 'player-policy', 'player-level', 'player-lives', 'reaction', 'jobs']);
    const opts = {};
    for (let i = 0; i < args.length; i += 2) {
        const name = args[i].replace(/^--/, '');
        if (!args[i].startsWith('--') || !allowed.has(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid option: ${args[i]}`);
        opts[name] = args[i + 1];
    }
    const candidate = opts.candidate || 'tactical-v2', baseline = opts.baseline || 'tactical-v1';
    if (!VERSIONS.includes(candidate) || !VERSIONS.includes(baseline) || candidate === baseline) throw new Error('Select two different registered versions');
    const maps = opts.maps === 'all' ? (await readdir(mapsURL)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort()
        : (opts.maps || '1,7,15,Bunker,The_Void').split(',');
    const seeds = (opts.seeds || '1,2,3').split(',').map(Number);
    if (seeds.some(s => !Number.isInteger(s) || s < 0 || s > 0xFFFFFFFF)) throw new Error('Seeds must be uint32 integers');
    const config = { ticks: Number(opts.ticks || 7200), tanks: Number(opts.tanks || 4), reserve: Number(opts.reserve || 12),
        bases: opts.bases !== 'false', vibranium: opts.vibranium !== 'false',
        players: Number(opts.players || 0), playerPolicy: opts['player-policy'] || 'evasive',
        playerLevel: Number(opts['player-level'] || 4), playerLives: Number(opts['player-lives'] ?? 4), reaction: Number(opts.reaction || 6) };
    if (!Number.isInteger(config.players) || config.players < 0 || config.players > 2) throw new Error('players must be 0, 1 or 2');
    if (!PLAYER_POLICIES.includes(config.playerPolicy)) throw new Error('Unknown player policy');
    if (!Number.isInteger(config.playerLevel) || config.playerLevel < 1 || config.playerLevel > 4) throw new Error('player-level must be 1..4');
    if (!Number.isInteger(config.playerLives) || config.playerLives < 0) throw new Error('player-lives must be >= 0');
    if (!Number.isInteger(config.reaction) || config.reaction < 1) throw new Error('reaction must be >= 1');
    for (const name of ['ticks', 'tanks', 'reserve']) if (!Number.isInteger(config[name]) || config[name] < 1) throw new Error(`${name} must be a positive integer`);
    for (const name of ['bases', 'vibranium']) if (opts[name] && !['true', 'false'].includes(opts[name])) throw new Error(`${name} must be true or false`);
    const capacity = cpuCapacity();
    const requestedJobs = opts.jobs === undefined ? capacity.defaultJobs : validateJobs(Number(opts.jobs));
    const tasks = [];
    for (const map of maps) {
        for (const seed of seeds) {
            for (const side of [1, 2]) {
                tasks.push({ ...config, map, seed, playerSide: 3 - side, versions: { [side]: candidate, [3 - side]: baseline } });
            }
        }
    }
    const jobs = Math.min(requestedJobs, tasks.length);
    const hash = await sourceHash();
    const started = performance.now();
    console.log(`Running ${tasks.length} games with ${jobs} workers (available CPUs: ${capacity.availableParallelism}, CPU quota: ${capacity.cpuQuota ?? 'unlimited'})`);
    const games = await runTournament(tasks, { jobs: requestedJobs, onProgress: ({ completed, total, index, task, result: game }) => {
        const side = 3 - task.playerSide;
        console.log(`[${completed}/${total}] game=${index + 1} ${game.map} seed=${game.seed} candidate=${side} ${game.winner ? (game.winner === side ? 'WIN' : 'LOSS') : game.ending.toUpperCase()} (${game.gameSeconds.toFixed(1)}s)`);
    } });
    const report = { candidate, baseline, sourceHash: hash, node: process.version, config, seeds,
        execution: { backend: 'worker_threads', jobs, requestedJobs, ...capacity, totalMs: performance.now() - started },
        summary: summarize(games, candidate), byMap: Object.fromEntries(maps.map(map => [map, summarize(games.filter(g => g.map === map), candidate)])), games };
    console.log(JSON.stringify(report.summary, null, 2));
    if (opts.output) await writeFile(opts.output, JSON.stringify(report, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
