import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runAblation } from '../tools/ai-ablation.js';

test('component experiments share reference games without creating false A/A differences', async () => {
    const report = await runAblation({ candidates: ['tactical-v5', 'experiment-v6-yield'],
        maps: ['1'], seeds: [21101], ticks: 240, jobs: 2 });
    assert.equal(report.execution.referenceGames, 6);
    assert.equal(report.execution.simulatedGames, 12);
    assert.equal(report.games.filter(record => record.arm === 'reference').length, 6);
    for (const group of Object.values(report.comparisons['tactical-v5'].summary)) assert.equal(group.meanDelta, 0);
    for (const cell of report.comparisons['tactical-v5'].cells) {
        assert.deepEqual(cell.arms.candidate.teamGame, cell.arms.reference.teamGame);
    }
    for (const name of ['bots', 'player', 'encounter']) {
        assert.equal(report.comparisons['experiment-v6-yield'].summary[name].gamesPerArm, 2);
    }
    assert.match(report.runnerHash, /^[a-f0-9]{64}$/);
    assert.equal(report.evaluatorHash, createHash('sha256').update(
        await readFile(new URL('../tools/ai-evaluate.js', import.meta.url))).digest('hex'));
});

test('invalid component coordinates fail before workers start', async () => {
    for (const candidates of [[], ['tactical-v5', 'tactical-v5'], ['missing']]) {
        await assert.rejects(runAblation({ candidates }));
    }
});
