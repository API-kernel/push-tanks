import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildEvaluationPlan, gradeGame, runEvaluation, summarizeEvaluation } from '../tools/ai-evaluate.js';
import { validateSimulationOptions } from '../tools/ai-benchmark.js';

const policies = { candidate: 'tactical-v2', reference: 'tactical-v1', opponent: 'tactical-v1' };
const exec = promisify(execFile);

function fakeGame(task, { winner = null, ending = 'timeout', playerKills = 0 } = {}) {
    const config = task.options;
    const metrics = Object.fromEntries([1, 2].map(side => [side,
        { kills: 0, playerKills: 0, botKills: 0, hits: 0, shots: 0, bonuses: 0, baseKills: 0 }]));
    metrics[config.candidateSide].kills = metrics[config.candidateSide].playerKills = playerKills;
    return { map: config.map, mapHash: `${config.map}-source`, seed: config.seed, versions: { ...config.versions },
        candidateSide: config.candidateSide, playerSide: config.players ? config.playerSide : null,
        winner, ending, ticks: config.ticks, gameSeconds: config.ticks / 60, metrics,
        fingerprint: 'physical-state', performance: { totalMs: 1 } };
}

test('task construction holds opponents and scenarios fixed across arms and mirrors sides', () => {
    const plan = buildEvaluationPlan({ ...policies, maps: ['1'], seeds: [7], ticks: 60 });
    assert.equal(plan.cells.length, 3);
    assert.equal(plan.tasks.length, 12);
    assert.deepEqual(plan.cells.map(cell => cell.kind), ['bots', 'player', 'encounter']);
    for (let index = 0; index < plan.tasks.length; index += 2) {
        const candidate = plan.tasks[index], reference = plan.tasks[index + 1];
        assert.equal(candidate.arm, 'candidate');
        assert.equal(reference.arm, 'reference');
        assert.equal(candidate.cellId, reference.cellId);
        const { versions: a, ...scenarioA } = candidate.options;
        const { versions: b, ...scenarioB } = reference.options;
        assert.deepEqual(scenarioA, scenarioB);
        const side = scenarioA.candidateSide;
        assert.equal(a[side], policies.candidate);
        assert.equal(b[side], policies.reference);
        assert.equal(a[3 - side], policies.opponent);
        assert.equal(b[3 - side], policies.opponent);
        assert.equal(scenarioA.playerSide, 3 - side);
        validateSimulationOptions(candidate.options);
        validateSimulationOptions(reference.options);
    }
    for (const cell of plan.cells) {
        assert.deepEqual(plan.tasks.filter(task => task.cellId === cell.id).map(task => task.options.candidateSide), [1, 1, 2, 2]);
    }
    assert.equal(buildEvaluationPlan(policies).tasks.length, 48);
});

test('release league includes frozen v1/v2 and both complete 18-profile ladders', () => {
    const plan = buildEvaluationPlan({ ...policies, suite: 'release' });
    assert.equal(plan.cells.length, 38);
    assert.equal(plan.tasks.length, 2280);
    assert.deepEqual(plan.cells.filter(cell => cell.kind === 'bots').map(cell => cell.opponent), ['tactical-v1', 'tactical-v2']);
    for (const kind of ['player', 'encounter']) {
        const cells = plan.cells.filter(cell => cell.kind === kind);
        assert.equal(cells.length, 18);
        assert.equal(new Set(cells.map(cell => JSON.stringify([
            cell.options.playerPolicy, cell.options.playerLevel, cell.options.reaction,
        ]))).size, 18);
        assert.deepEqual([...new Set(cells.map(cell => cell.options.playerPolicy))], ['evasive', 'duelist', 'rusher']);
        assert.deepEqual([...new Set(cells.map(cell => cell.options.playerLevel))], [1, 4]);
        assert.deepEqual([...new Set(cells.map(cell => cell.options.reaction))], [3, 6, 12]);
    }
    assert.ok(plan.cells.filter(cell => cell.kind === 'encounter').every(cell =>
        cell.options.bases === false && cell.options.playerLives === 0 && cell.options.players === 1 && cell.options.tanks === 1));
    assert.ok(plan.cells.filter(cell => cell.kind === 'player').every(cell =>
        cell.options.bases === true && cell.options.playerLives === 3 && cell.options.tanks === 4));
    assert.equal(buildEvaluationPlan({ ...policies, suite: 'player', maps: ['1'], seeds: [7] }).cells.length, 18);
    assert.equal(buildEvaluationPlan({ ...policies, suite: 'encounter', maps: ['1'], seeds: [7] }).cells.length, 18);
    const extraOpponent = buildEvaluationPlan({ ...policies, opponent: 'legacy', suite: 'release', maps: ['1'], seeds: [7] });
    assert.deepEqual(extraOpponent.cells.filter(cell => cell.kind === 'bots').map(cell => cell.opponent), ['legacy', 'tactical-v1', 'tactical-v2']);
});

test('plans reject unknown policies and ambiguous or invalid evaluation coordinates', () => {
    for (const options of [
        { candidate: 'unknown' }, { reference: 'unknown' }, { opponent: 'unknown' }, { suite: 'unknown' },
        { maps: [] }, { maps: [''] }, { maps: ['1', '1'] },
        { seeds: [] }, { seeds: [-1] }, { seeds: [0x100000000] }, { seeds: [1.5] }, { seeds: [7, 7] },
        { ticks: 0 }, { ticks: Infinity },
    ]) assert.throws(() => buildEvaluationPlan({ ...policies, ...options }));
    assert.doesNotThrow(() => buildEvaluationPlan({ ...policies, candidate: policies.reference }));
});

test('team grading keeps timeouts explicit and encounter grading uses typed player kills', () => {
    const plan = buildEvaluationPlan({ ...policies, maps: ['1'], seeds: [7] });
    const task = plan.tasks[0], objective = plan.cells[0], encounter = plan.cells.find(cell => cell.kind === 'encounter');
    const win = fakeGame(task, { winner: 1, ending: 'victory' });
    const loss = fakeGame(task, { winner: 2, ending: 'victory' });
    const timeout = fakeGame(task);
    assert.deepEqual(gradeGame(win, objective), { score: 1, result: 'win', teamResult: 'win' });
    assert.equal(gradeGame(loss, objective).score, 0);
    assert.deepEqual(gradeGame(timeout, objective), { score: 0.5, result: 'timeout', teamResult: 'timeout' });
    assert.deepEqual(gradeGame({ ...timeout, ending: 'draw' }, objective), { score: 0.5, result: 'draw', teamResult: 'draw' });
    assert.equal(gradeGame(win, encounter).score, 0);
    const proxyKilledDespiteTeamLoss = fakeGame(task, { winner: 2, ending: 'victory', playerKills: 1 });
    assert.deepEqual(gradeGame(proxyKilledDespiteTeamLoss, encounter), { score: 1, result: 'proxy-destroyed', teamResult: 'loss' });
    assert.equal(gradeGame(fakeGame(task, { playerKills: 1 }), encounter).score, 1);
    assert.equal(gradeGame(timeout, encounter).score, 0);
    delete timeout.metrics[1].playerKills;
    timeout.metrics[1].kills = timeout.metrics[1].botKills = 4;
    assert.throws(() => gradeGame(timeout, encounter), /typed playerKills/);
    assert.throws(() => gradeGame({ ...win, ending: 'timeout' }, objective), /inconsistent team outcome/);
});

test('paired deltas aggregate mirrored sides before map-seed summaries and keep scoring groups separate', () => {
    const plan = buildEvaluationPlan({ ...policies, maps: ['1'], seeds: [7, 9] });
    const results = plan.tasks.map(task => {
        const side = task.options.candidateSide;
        if (task.cellId.startsWith('bots:')) {
            if (task.options.seed === 7) {
                const won = (task.arm === 'candidate') === (side === 1);
                return fakeGame(task, { winner: won ? side : 3 - side, ending: 'victory' });
            }
            if (task.arm === 'candidate') return fakeGame(task, { winner: side, ending: 'victory' });
        }
        return fakeGame(task, { playerKills: task.cellId.startsWith('encounter:') && task.arm === 'candidate' ? 1 : 0 });
    });
    const report = summarizeEvaluation(plan, results);
    const bots = report.cells.find(cell => cell.kind === 'bots');
    assert.equal(bots.paired.count, 2);
    assert.equal(bots.paired.unit, 'map-seed-with-mirrored-sides');
    assert.deepEqual(bots.paired.samples[0].sides.map(side => side.delta), [1, -1]);
    assert.equal(bots.paired.samples[0].delta, 0);
    assert.equal(bots.paired.samples[1].delta, 0.5);
    assert.equal(bots.paired.meanDelta, 0.25);
    assert.equal(bots.paired.improved, 1);
    assert.equal(bots.paired.tied, 1);
    assert.equal(bots.arms.reference.teamGame.timeouts, 2);
    assert.equal(bots.arms.reference.teamGame.completedDraws, 0);
    assert.equal(report.summary.bots.meanDelta, 0.25);
    assert.equal(report.summary.encounter.scoreBasis, 'proxy-destruction');
    assert.equal(report.summary.encounter.meanDelta, 1);
    assert.equal(report.cells.find(cell => cell.kind === 'encounter').arms.candidate.teamGame.wins, 0);
    assert.equal(report.games.length, plan.tasks.length);
});

test('pairing rejects missing, mismatched and changed-map results', () => {
    const plan = buildEvaluationPlan({ ...policies, maps: ['1'], seeds: [7] });
    const results = plan.tasks.map(task => fakeGame(task));
    assert.throws(() => summarizeEvaluation(plan, results.slice(1)), /result count/);
    const wrongSide = structuredClone(results);
    wrongSide[0].candidateSide = 2;
    assert.throws(() => summarizeEvaluation(plan, wrongSide), /does not match task 0/);
    const wrongPolicy = structuredClone(results);
    wrongPolicy[0].versions[1] = 'legacy';
    assert.throws(() => summarizeEvaluation(plan, wrongPolicy), /does not match task 0/);
    const changedMap = structuredClone(results);
    changedMap[1].mapHash = 'different-map';
    assert.throws(() => summarizeEvaluation(plan, changedMap), /map source differs/);
});

test('small real v2/v1 evaluation preserves raw ordering and physical states across worker counts', async () => {
    const options = { ...policies, suite: 'quick', maps: ['1'], seeds: [19], ticks: 240 };
    const progress = [];
    const sequential = await runEvaluation({ ...options, jobs: 1 });
    const parallel = await runEvaluation({ ...options, jobs: 2, onProgress: event => progress.push(event) });
    const physical = report => report.games.map(({ game: { performance, ...game }, ...record }) => ({ ...record, game }));
    assert.deepEqual(physical(parallel), physical(sequential));
    assert.deepEqual(parallel.cells, sequential.cells);
    assert.deepEqual(parallel.summary, sequential.summary);
    assert.equal(progress.length, 12);
    assert.equal(progress.at(-1).completed, 12);
    assert.equal(progress.at(-1).total, 12);
    assert.ok(progress.every(event => event.evaluationTask.arm === 'candidate' || event.evaluationTask.arm === 'reference'));
    assert.equal(parallel.execution.jobs, 2);
    assert.match(parallel.sourceHash, /^[a-f0-9]{64}$/);
    assert.match(parallel.evaluatorHash, /^[a-f0-9]{64}$/);
    assert.match(parallel.methodology.initialPlayerLevel, /respawns reset it to level 1/);
    assert.match(parallel.methodology.performance, /separate benchmark/);
    assert.ok(parallel.games.every(record => /^[a-f0-9]{64}$/.test(record.game.fingerprint)));
});

test('CLI writes a complete report, reports progress and validates jobs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arena-eval-cli-'));
    const base = ['tools/ai-evaluate.js', '--candidate', 'tactical-v2', '--reference', 'tactical-v1',
        '--suite', 'quick', '--maps', '1', '--seeds', '19', '--ticks', '60'];
    try {
        const output = join(directory, 'report.json');
        const { stdout, stderr } = await exec(process.execPath, [...base, '--jobs', '2', '--output', output], { cwd: new URL('../', import.meta.url) });
        const report = JSON.parse(await readFile(output, 'utf8'));
        assert.equal(JSON.parse(stdout).output, output);
        assert.equal(report.games.length, 12);
        assert.equal(report.cells.length, 3);
        assert.equal(report.config.candidate, 'tactical-v2');
        assert.match(stderr, /\[12\/12\]/);
        await assert.rejects(exec(process.execPath, [...base, '--jobs', '0'], { cwd: new URL('../', import.meta.url) }),
            error => /jobs must be a positive integer/.test(error.stderr));
        await assert.rejects(runEvaluation({ ...policies, maps: ['1'], seeds: '7,', jobs: 1 }), /Invalid seeds/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
