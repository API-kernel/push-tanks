import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { cpuCapacity, runTournament, SimulationPool } from '../tools/ai-pool.js';
import { simulate, sourceHash, summarize } from '../tools/ai-benchmark.js';
import { DEFAULT_BOT_VERSION } from '../shared/ai/versions.js';

const exec = promisify(execFile);
const cwd = new URL('../', import.meta.url);

function fixtureReader(files) {
    return path => {
        if (!(path in files)) throw new Error('not mounted');
        return files[path];
    };
}

function workerURL(source) {
    return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

function physical(games) {
    return games.map(({ performance, ...game }) => game);
}

test('default concurrency respects affinity and parent cgroup quotas', () => {
    assert.deepEqual(cpuCapacity({ parallelism: 12, read: fixtureReader({
        '/proc/self/cgroup': '0::/parent/child',
        '/sys/fs/cgroup/cpu.max': 'max 100000',
        '/sys/fs/cgroup/parent/cpu.max': '250000 100000',
        '/sys/fs/cgroup/parent/child/cpu.max': '600000 100000',
    }) }), { availableParallelism: 12, cpuQuota: 2.5, defaultJobs: 2 });
    assert.equal(cpuCapacity({ parallelism: 2, read: fixtureReader({
        '/sys/fs/cgroup/cpu.max': '800000 100000',
    }) }).defaultJobs, 2);
    assert.equal(cpuCapacity({ parallelism: 12, read: fixtureReader({
        '/sys/fs/cgroup/cpu.max': '50000 100000',
    }) }).defaultJobs, 1);
    assert.deepEqual(cpuCapacity({ parallelism: 7, read: fixtureReader({}) }),
        { availableParallelism: 7, cpuQuota: null, defaultJobs: 7 });
});

test('legacy cgroup CPU quota limits default concurrency', () => {
    assert.deepEqual(cpuCapacity({ parallelism: 16, read: fixtureReader({
        '/proc/self/cgroup': '3:cpu,cpuacct:/tournament',
        '/sys/fs/cgroup/cpu,cpuacct/tournament/cpu.cfs_quota_us': '300000',
        '/sys/fs/cgroup/cpu,cpuacct/tournament/cpu.cfs_period_us': '100000',
    }) }), { availableParallelism: 16, cpuQuota: 3, defaultJobs: 3 });
});

test('jobs must be a positive integer', () => {
    for (const jobs of [0, -1, 1.5, NaN, Infinity, '2']) {
        assert.throws(() => new SimulationPool({ jobs }), /jobs must be a positive integer/);
    }
});

test('exported simulations reject invalid numeric options and unknown policies before map loading', async () => {
    const invalid = [
        [{ ticks: 0 }, /ticks/], [{ ticks: Infinity }, /ticks/], [{ ticks: 1.5 }, /ticks/],
        [{ tanks: NaN }, /tanks/], [{ tanks: -1 }, /tanks/], [{ tanks: Number.MAX_SAFE_INTEGER + 1 }, /tanks/],
        [{ reserve: 0 }, /reserve/], [{ reserve: Infinity }, /reserve/],
        [{ reaction: 0 }, /reaction/], [{ reaction: Infinity }, /reaction/],
        [{ seed: -1 }, /seed/], [{ seed: 0x100000000 }, /seed/], [{ seed: Infinity }, /seed/],
        [{ players: 3 }, /players/], [{ players: Infinity }, /players/], [{ players: 2, tanks: 1 }, /players must not exceed tanks/],
        [{ playerSide: 0 }, /playerSide/], [{ candidateSide: 3 }, /candidateSide/],
        [{ playerLevel: 0 }, /player-level/], [{ playerLevel: Infinity }, /player-level/],
        [{ playerLives: -1 }, /player-lives/], [{ playerLives: Infinity }, /player-lives/],
        [{ bases: 'false' }, /bases/], [{ vibranium: 0 }, /vibranium/],
        [{ playerPolicy: 'unknown-player' }, /Unknown player policy/],
        [{ versions: { 1: 'unknown-bot', 2: 'tactical-v1' } }, /registered policy/],
        [{ versions: { 1: 'tactical-v2', 2: 'unknown-bot' } }, /registered policy/],
        [{ versions: { 1: 'tactical-v1' } }, /registered policy/],
    ];
    for (const [options, expected] of invalid) {
        await assert.rejects(simulate({ map: 'missing-validation-test-map', ...options }), expected);
    }
    await assert.rejects(simulate(null), /options must be an object/);
    await assert.rejects(simulate([]), /options must be an object/);
});

test('same-policy grading follows candidateSide and old reports use an unambiguous version match', () => {
    const game = { versions: { 1: 'tactical-v2', 2: 'tactical-v2' }, candidateSide: 2,
        winner: 2, ending: 'victory', metrics: {
            1: { kills: 4, playerKills: 2, botKills: 2, bonuses: 1, baseKills: 0 },
            2: { kills: 7, playerKills: 3, botKills: 4, bonuses: 2, baseKills: 1 },
        } };
    const summary = summarize([game], 'tactical-v2');
    assert.equal(summary.outcomeBasis, 'team-game');
    assert.equal(summary.wins, 1);
    assert.equal(summary.losses, 0);
    assert.equal(summary.candidateKills, 7);
    assert.equal(summary.candidatePlayerKills, 3);
    assert.equal(summary.opponentPlayerKills, 2);
    assert.equal(summary.candidateBotKills, 4);
    assert.equal(summary.opponentBotKills, 2);
    const mirrored = summarize([{ ...game, candidateSide: 1 }], 'tactical-v2');
    assert.equal(mirrored.wins, 0);
    assert.equal(mirrored.losses, 1);
    assert.equal(mirrored.candidatePlayerKills, 2);
    const timeout = summarize([{ ...game, candidateSide: 1, winner: null, ending: 'timeout' }], 'tactical-v2');
    assert.equal(timeout.candidatePlayerKills, 2);
    assert.equal(timeout.wins, 0);
    assert.equal(timeout.draws, 1);
    assert.equal(timeout.timeouts, 1);
    const oldReport = { ...game, candidateSide: undefined, versions: { 1: 'tactical-v1', 2: 'tactical-v2' },
        metrics: { 1: { kills: 4, bonuses: 1, baseKills: 0 }, 2: { kills: 7, bonuses: 2, baseKills: 1 } } };
    const fallback = summarize([oldReport], 'tactical-v2');
    assert.equal(fallback.wins, 1);
    assert.equal(fallback.candidateKills, 7);
    assert.equal(fallback.candidatePlayerKills, 0);
    assert.throws(() => summarize([{ ...game, candidateSide: undefined }], 'tactical-v2'), /set candidateSide explicitly/);
});

test('real player deaths and bot deaths are counted separately from team match outcomes', async () => {
    const playerGame = await simulate({ map: 'The_Void', seed: 4, versions: { 1: 'tactical-v2', 2: 'tactical-v2' },
        candidateSide: 1, ticks: 3000, tanks: 1, reserve: 3, bases: false, vibranium: false,
        players: 1, playerSide: 2, playerPolicy: 'rusher', playerLevel: 1, playerLives: 1, reaction: 12 });
    assert.equal(playerGame.metrics[1].playerKills, 2);
    assert.equal(playerGame.metrics[1].kills, playerGame.metrics[1].playerKills + playerGame.metrics[1].botKills);
    const playerSummary = summarize([playerGame], 'tactical-v2');
    assert.equal(playerSummary.candidatePlayerKills, 2);
    assert.equal(playerSummary.wins, Number(playerGame.winner === 1));
    assert.equal(playerSummary.losses, Number(playerGame.winner === 2));
    const botGame = await simulate({ map: '1', seed: 1, candidateSide: 1, ticks: 1800, tanks: 2, reserve: 3, bases: false });
    assert.ok(botGame.metrics[1].botKills > 0);
    for (const metrics of Object.values(botGame.metrics)) {
        assert.equal(metrics.playerKills, 0);
        assert.equal(metrics.botKills, metrics.kills);
    }
});

test('physical states, metrics and ordering match direct replay with one or multiple workers', async () => {
    const tasks = [
        { map: '1', seed: 27, ticks: 480, tanks: 2, reserve: 3 },
        { map: '7', seed: 84, ticks: 480, tanks: 2, reserve: 3, versions: { 1: 'tactical-v1', 2: 'tactical-v2' } },
        { map: '1', seed: 91, ticks: 480, tanks: 2, reserve: 3, players: 1, playerSide: 2,
            playerPolicy: 'duelist', playerLevel: 3, playerLives: 2, reaction: 4 },
        { map: '7', seed: 91, ticks: 480, tanks: 2, reserve: 3, players: 2, playerSide: 1,
            playerPolicy: 'rusher', playerLevel: 4, playerLives: 0, reaction: 6 },
        { map: 'The_Void', seed: 4, versions: { 1: 'tactical-v2', 2: 'tactical-v2' }, candidateSide: 1,
            ticks: 3000, tanks: 1, reserve: 3, bases: false, vibranium: false,
            players: 1, playerSide: 2, playerPolicy: 'rusher', playerLevel: 1, playerLives: 1, reaction: 12 },
        { map: '1', seed: 6, versions: { 1: 'tactical-v1', 2: 'tactical-v1' }, candidateSide: 2,
            ticks: 480, tanks: 1, reserve: 3, players: 1, playerSide: 1,
            playerPolicy: 'evasive', playerLevel: 4, playerLives: 0, reaction: 3 },
    ];
    const direct = [];
    for (const task of tasks) direct.push(await simulate(task));
    const oneWorker = await runTournament(tasks, { jobs: 1 });
    const parallel = await runTournament(tasks, { jobs: 3 });
    assert.deepEqual(physical(oneWorker), physical(direct));
    assert.deepEqual(physical(parallel), physical(direct));
    assert.ok(direct.every(game => /^[a-f0-9]{64}$/.test(game.fingerprint)));
});

test('workers persist across runs and progress tracks completed tasks', async () => {
    const pool = new SimulationPool({ jobs: 2, workerURL: workerURL(`
        import { parentPort, threadId } from 'node:worker_threads';
        parentPort.on('message', ({ id, config }) => {
            setTimeout(() => parentPort.postMessage({ id, result: { value: config.value, threadId } }), config.delay);
        });
    `) });
    try {
        const progress = [];
        const first = await pool.run([
            { value: 'a', delay: 150 }, { value: 'b', delay: 5 },
            { value: 'c', delay: 5 }, { value: 'd', delay: 5 },
        ], { onProgress: event => progress.push(event) });
        assert.deepEqual(first.map(result => result.value), ['a', 'b', 'c', 'd']);
        assert.deepEqual(progress.map(event => event.completed), [1, 2, 3, 4]);
        assert.deepEqual(progress.map(event => event.index).sort(), [0, 1, 2, 3]);
        assert.ok(progress.every(event => event.total === 4 && event.jobs === 2));
        assert.equal(pool.workerCount, 2);
        const second = await pool.run([{ value: 'e', delay: 1 }, { value: 'f', delay: 1 }]);
        assert.deepEqual(new Set(second.map(result => result.threadId)), new Set(first.map(result => result.threadId)));
    } finally { await pool.close(); }
    assert.equal(pool.closed, true);
    assert.equal(pool.workerCount, 0);
});

test('a simulation failure terminates other workers before rejecting', { timeout: 10000 }, async () => {
    const pool = new SimulationPool({ jobs: 2 });
    try {
        await assert.rejects(pool.run([
            { map: '1', seed: 1, ticks: 100000000 },
            { map: 'missing-pool-test-map', ticks: 1 },
        ]), error => error.code === 'ENOENT' && error.taskIndex === 1 && /missing-pool-test-map/.test(error.message));
        assert.equal(pool.closed, true);
        assert.equal(pool.workerCount, 0);
        await assert.rejects(pool.run([{ ticks: 1 }]), /pool is closed/);
    } finally { await pool.close(); }
});

test('unexpected worker exit is propagated and the pool is cleaned up', { timeout: 10000 }, async () => {
    const pool = new SimulationPool({ jobs: 2, workerURL: workerURL(`
        import { parentPort } from 'node:worker_threads';
        parentPort.on('message', ({ config }) => {
            if (config.crash) process.exit(7);
            setInterval(() => {}, 1000);
        });
    `) });
    try {
        await assert.rejects(pool.run([{ crash: false }, { crash: true }]), /worker exited unexpectedly \(code 7\)/);
        assert.equal(pool.workerCount, 0);
        assert.equal(pool.closed, true);
    } finally { await pool.close(); }
});

test('a progress callback failure also closes every worker', async () => {
    const pool = new SimulationPool({ jobs: 2 });
    const failure = new Error('progress failed');
    try {
        await assert.rejects(pool.run([{ ticks: 1 }, { ticks: 100000000 }], {
            onProgress() { throw failure; },
        }), error => error === failure);
        assert.equal(pool.workerCount, 0);
        assert.equal(pool.closed, true);
    } finally { await pool.close(); }
});

test('CLI accepts jobs and records concurrency and source metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'push-tanks-ai-pool-'));
    try {
        const output = join(directory, 'report.json');
        const { stdout } = await exec(process.execPath, ['tools/ai-benchmark.js', '--maps', '1', '--seeds', '42',
            '--ticks', '60', '--tanks', '1', '--reserve', '1', '--jobs', '2', '--players', '1',
            '--player-policy', 'evasive', '--player-level', '2', '--player-lives', '1', '--reaction', '4', '--output', output], { cwd });
        const report = JSON.parse(await readFile(output, 'utf8'));
        assert.equal(report.execution.backend, 'worker_threads');
        assert.equal(report.execution.jobs, 2);
        assert.equal(report.execution.requestedJobs, 2);
        assert.ok(report.execution.availableParallelism >= 1);
        assert.equal(report.execution.timing, 'pool-wall-clock-including-startup-and-cleanup');
        assert.ok(Number.isFinite(report.execution.gamesPerSecond) && report.execution.gamesPerSecond > 0);
        assert.ok(Number.isFinite(report.execution.simulatedTicksPerSecond) && report.execution.simulatedTicksPerSecond > 0);
        assert.equal(report.games[0].performance.timing, 'per-match-wall-clock-including-contention');
        assert.equal(report.games[0].performance.scope, 'simulation-loop');
        assert.equal(report.sourceHash, await sourceHash());
        assert.equal(report.node, process.version);
        assert.equal(report.games.length, 2);
        assert.deepEqual(report.games.map(game => game.versions[1]), [DEFAULT_BOT_VERSION, 'tactical-v2']);
        assert.deepEqual(report.games.map(game => game.candidateSide), [1, 2]);
        assert.equal(report.selfPlay, false);
        assert.match(stdout, /\[2\/2\]/);
        await assert.rejects(exec(process.execPath, ['tools/ai-benchmark.js', '--jobs', '0'], { cwd }),
            error => /jobs must be a positive integer/.test(error.stderr));
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI supports explicit self-play and same-policy player scenarios without relaxing team capacity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'push-tanks-ai-self-play-'));
    const base = ['tools/ai-benchmark.js', '--candidate', 'tactical-v2', '--baseline', 'tactical-v2', '--maps', '1', '--seeds', '3',
        '--ticks', '60', '--tanks', '1', '--reserve', '1', '--jobs', '2'];
    try {
        for (const options of [['--self-play', 'true'], ['--players', '1']]) {
            const output = join(directory, `report-${options[0].slice(2)}.json`);
            await exec(process.execPath, [...base, ...options, '--output', output], { cwd });
            const report = JSON.parse(await readFile(output, 'utf8'));
            assert.equal(report.selfPlay, true);
            assert.deepEqual(report.games.map(game => game.candidateSide), [1, 2]);
            assert.ok(report.games.every(game => game.versions[1] === 'tactical-v2' && game.versions[2] === 'tactical-v2'));
            assert.deepEqual(report.summary, summarize(report.games, report.candidate));
        }
        await assert.rejects(exec(process.execPath, base, { cwd }), error => /require --self-play true/.test(error.stderr));
        await assert.rejects(exec(process.execPath, [...base, '--self-play', 'false'], { cwd }), error => /require --self-play true/.test(error.stderr));
        await assert.rejects(exec(process.execPath, [...base, '--self-play', 'sometimes'], { cwd }), error => /self-play must be true or false/.test(error.stderr));
        await assert.rejects(exec(process.execPath, [...base, '--players', '2'], { cwd }), error => /players must not exceed tanks/.test(error.stderr));
    } finally { await rm(directory, { recursive: true, force: true }); }
});
