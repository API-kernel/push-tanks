import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { GameRoom } from '../game_room.js';
import { TANK_STATS } from '../shared/config.js';
import { createBullet, updateBullets } from '../shared/bullet.js';
import { simulate } from '../tools/ai-benchmark.js';
import { SimulationPool, runTournament } from '../tools/ai-pool.js';
import { ReactivePlayerProxy, REACTIVE_PLAYER_POLICIES } from '../tools/reactive-player-proxy.js';
import { buildChallengePlan, crossfireGeometry, normalizeChallengeOptions, runChallenges, simulateChallenge, summarizeChallenges } from '../tools/ai-challenge.js';

const workerURL = new URL('../tools/ai-challenge.js', import.meta.url);
const exec = promisify(execFile);
const input = direction => ({ up: direction === 'UP', down: direction === 'DOWN', left: direction === 'LEFT',
    right: direction === 'RIGHT', fire: false, cheat0: false });

function fixture() {
    const room = new GameRoom('CHALLENGE', null, [], { seed: 71, silent: true });
    room.settings.basesEnabled = false;
    room.settings.botsReserve = { 1: 0, 2: 0 };
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    room.addPlayer('P', 0, 'Proxy');
    const player = room.players.P_0;
    Object.assign(player, { x: 80, y: 80, direction: 'UP', isDead: false, isSpawning: false,
        shieldTimer: 0, bulletCooldown: 999, level: 1, hp: 1, lives: 0 });
    const enemy = { id: 1000, team: 2, x: 80, y: 0, width: 16, height: 16, direction: 'DOWN',
        speed: TANK_STATS.basic.speed, hp: 1, level: 1, bulletSpeed: 4, bulletTimer: 999, bulletCooldownMax: 60 };
    room.enemies.push(enemy);
    return { room, player, enemy };
}

function controlled(options) {
    const state = fixture();
    const proxy = new ReactivePlayerProxy(state.room, state.player.id, { seed: 17, reaction: 1, ...options });
    proxy.duelist.decide = () => input('UP');
    proxy.rusher.decide = () => input('RIGHT');
    return { ...state, proxy };
}

test('reactive adversary turns only after observing a real projectile and its requested delay', () => {
    const { room, player, enemy, proxy } = controlled({ delays: [2], continueProbability: 0 });
    assert.equal(proxy.decide().up, true);
    room.bullets.push(createBullet(enemy, 4));
    const before = JSON.stringify([room.players, room.enemies, room.bullets, room.map, room.effectTimers]);
    assert.equal(proxy.decide().up, true);
    assert.equal(proxy.stats.reactions, 0);
    assert.equal(proxy.decide().up, true);
    assert.equal(proxy.stats.reactions, 0);
    const action = proxy.decide();
    assert.ok(action.left || action.right);
    assert.equal(proxy.stats.reactions, 1);
    assert.deepEqual(proxy.diagnostics().reactionSamples, [{ observedTick: 2, reactedTick: 4, requestedDelay: 2, actualDelay: 2 }]);
    assert.equal(JSON.stringify([room.players, room.enemies, room.bullets, room.map, room.effectTimers]), before);
    assert.equal(player.x, 80);
});

test('seeded delay variation and deliberate continuation replay exactly', () => {
    function sequence() {
        const { room, enemy, proxy } = controlled({ continueProbability: .25 });
        const outputs = [proxy.decide()];
        for (let tick = 0; tick < 24; tick++) {
            if (tick % 2 === 0) room.bullets.push(createBullet(enemy, 4));
            outputs.push(proxy.decide());
        }
        return { outputs, diagnostics: proxy.diagnostics() };
    }
    const a = sequence(), b = sequence();
    assert.deepEqual(a, b);
    assert.ok(Object.keys(a.diagnostics.delays).length > 1);
    assert.ok(a.diagnostics.continuedShots > 0);
    const { room, enemy, proxy } = controlled({ continueProbability: 1 });
    proxy.decide();
    room.bullets.push(createBullet(enemy, 4));
    for (let tick = 0; tick < 8; tick++) assert.equal(proxy.decide().up, true);
    assert.equal(proxy.stats.reactions, 0);
    assert.equal(proxy.stats.continuedShots, 1);
});

test('the reactive input survives a real shell that kills deliberate continuation', () => {
    function encounter(continueProbability) {
        const { room, player, enemy, proxy } = controlled({ delays: [2], continueProbability });
        const bullet = createBullet(enemy, 4);
        Object.assign(bullet, { x: 86, y: 0 });
        room.bullets.push(bullet);
        const enemyBefore = JSON.stringify(enemy);
        for (let tick = 0; tick < 28; tick++) {
            player.inputs = proxy.decide();
            room.updatePlayer(player);
            updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false, room.random);
            room.battleSystem.update();
        }
        assert.equal(JSON.stringify(enemy), enemyBefore);
        return player.isDead;
    }
    assert.equal(encounter(0), false);
    assert.equal(encounter(1), true);
});

test('new policies use ordinary inputs without reading future packets or consuming engine RNG', () => {
    for (const policy of REACTIVE_PLAYER_POLICIES) {
        const { room, player, enemy } = fixture();
        Object.defineProperty(enemy, 'inputs', { enumerable: true, get() { throw new Error('future input read'); } });
        const world = () => JSON.stringify([room.players, room.enemies.map(tank => Object.fromEntries(
            Object.keys(tank).filter(key => key !== 'inputs').map(key => [key, tank[key]]))), room.map, room.bullets, room.effectTimers]);
        const before = world();
        room.random = () => { throw new Error('engine RNG consumed'); };
        const proxy = new ReactivePlayerProxy(room, player.id, { policy, seed: 912, reaction: 1 });
        let action;
        assert.doesNotThrow(() => { action = proxy.decide(); });
        assert.equal(action.cheat0, false);
        assert.ok([action.up, action.down, action.left, action.right].filter(Boolean).length <= 1);
        assert.equal(world(), before);
    }
});

test('switching style changes ordinary pursuit inputs and corner bait finds a real peek', () => {
    const { proxy } = controlled({ policy: 'switch-rush', switchTicks: 2 });
    assert.equal(proxy.decide().up, true);
    assert.equal(proxy.decide().right, true);
    proxy.decide();
    assert.equal(proxy.decide().up, true);
    assert.equal(proxy.stats.phaseSwitches, 2);
    const bait = controlled({ policy: 'bait-corner', peekTicks: 6 });
    bait.enemy.y = 32;
    bait.room.map[8][10] = { type: 1, mask: 2 };
    const action = bait.proxy.decide();
    assert.ok(action.left || action.right);
    assert.equal(bait.proxy.stats.peeks, 1);
});

test('challenge plans fix adversary seeds across candidates and mirrored sides, with explicit 2x1 reserves', () => {
    const plan = buildChallengePlan({ candidates: ['tactical-v2', 'tactical-v5'], reference: 'tactical-v5', maps: ['1'], seeds: [77],
        adversaries: ['old:duelist', 'reactive-dodge'], modes: ['encounter', 'crossfire'], levels: [4], reactions: [3], ticks: 60 });
    assert.equal(plan.cells.length, 4);
    assert.equal(plan.tasks.length, 24);
    for (let index = 0; index < plan.tasks.length; index += 3) {
        const group = plan.tasks.slice(index, index + 3);
        const comparable = task => { const { versions, ...options } = task.options; return options; };
        assert.deepEqual(comparable(group[0]), comparable(group[1]));
        assert.deepEqual(comparable(group[1]), comparable(group[2]));
        assert.equal(group[2].arm, 'reference');
        for (const task of group) {
            const options = task.options, side = options.candidateSide;
            assert.equal(options.initialReserves[side], options.mode === 'crossfire' ? 2 : 1);
            assert.equal(options.initialReserves[3 - side], options.mode === 'crossfire' ? 0 : 1);
            assert.equal(options.playerLives, 0);
            assert.equal(options.bases, false);
        }
    }
    for (const cell of plan.cells) assert.equal(new Set(plan.tasks.filter(task => task.cellId === cell.id).map(task => task.options.adversarySeed)).size, 1);
    assert.throws(() => normalizeChallengeOptions({ adversary: 'unknown' }), /Unknown adversary/);
    assert.throws(() => normalizeChallengeOptions({ adversarySeed: Infinity }), /uint32/);
});

test('ordinary objective fortifications reach the shared engine and invalid boolean options fail', async () => {
    const options = { mode: 'objective', adversary: 'old:duelist', ticks: 1, map: '1', seed: 17 };
    const ordinary = await simulateChallenge({ ...options, vibranium: false });
    assert.equal(ordinary.challengeOptions.vibranium, false);
    assert.equal(ordinary.observations.vibraniumEnabled, false);
    assert.equal((await simulateChallenge(options)).observations.vibraniumEnabled, true);
    const plan = buildChallengePlan({ candidates: ['tactical-v5'], maps: ['1'], seeds: [7], vibranium: false,
        modes: ['objective', 'crossfire'], adversaries: ['old:duelist'], levels: [4], reactions: [3], ticks: 1 });
    assert.equal(plan.config.vibranium, false);
    assert.ok(plan.tasks.every(task => task.options.vibranium === false));
    assert.equal(normalizeChallengeOptions({ mode: 'crossfire', vibranium: true }).vibranium, false);
    for (const value of ['false', 'true', 'unknown', 0, 1, null]) {
        await assert.rejects(simulateChallenge({ ...options, vibranium: value }), /vibranium must be a boolean/);
        assert.throws(() => buildChallengePlan({ vibranium: value }), /vibranium must be a boolean/);
    }
    await assert.rejects(exec(process.execPath, ['tools/ai-challenge.js', '--vibranium', 'sometimes'], {
        cwd: new URL('../', import.meta.url),
    }), error => /vibranium must be true or false/.test(error.stderr));
});

test('crossfire metric needs two distinct ready bots on perpendicular unblocked lanes', () => {
    const { room, player } = fixture();
    room.enemies = [{ id: 1000, team: 2, x: 32, y: 80, width: 16, height: 16, direction: 'RIGHT', level: 1, bulletSpeed: 2, bulletTimer: 0 },
        { id: 1001, team: 2, x: 80, y: 32, width: 16, height: 16, direction: 'DOWN', level: 1, bulletSpeed: 2, bulletTimer: 0 }];
    assert.deepEqual(crossfireGeometry(room, 2), { pairActive: true, twoAxes: true, twoReadyAxes: true });
    room.map[10][8] = { type: 2, mask: 15 };
    assert.equal(crossfireGeometry(room, 2).twoAxes, false);
    room.map[10][8] = 0;
    room.enemies[1].bulletTimer = 30;
    assert.equal(crossfireGeometry(room, 2).twoReadyAxes, false);
    room.enemies[1].x = 0; room.enemies[1].y = 80;
    assert.equal(crossfireGeometry(room, 2).twoAxes, false);
    player.shieldTimer = 10;
    assert.equal(crossfireGeometry(room, 2).pairActive, false);
});

test('old proxy challenge is the exact shared simulation, and new proxies replay across workers', async () => {
    const options = { map: '1', seed: 631, ticks: 300, mode: 'encounter', playerLevel: 4, reaction: 3,
        versions: { 1: 'tactical-v5', 2: 'tactical-v5' }, candidateSide: 1 };
    const old = await simulateChallenge({ ...options, adversary: 'old:duelist' });
    const standard = await simulate(normalizeChallengeOptions({ ...options, adversary: 'old:duelist' }));
    assert.equal(old.fingerprint, standard.fingerprint);
    assert.deepEqual(old.metrics, standard.metrics);
    const tasks = REACTIVE_PLAYER_POLICIES.map(adversary => ({ ...options, adversary }));
    const direct = [];
    for (const task of tasks) direct.push(await simulateChallenge(task));
    const parallel = await runTournament(tasks, { jobs: 2, workerURL });
    const physical = games => games.map(({ performance, ...game }) => game);
    assert.deepEqual(physical(parallel), physical(direct));
});

test('shared reference pairing and raw source metadata preserve same-policy control', async () => {
    const report = await runChallenges({ candidates: ['tactical-v5'], reference: 'tactical-v5', maps: ['1'], seeds: [631],
        adversaries: ['reactive-dodge'], modes: ['encounter', 'crossfire'], levels: [4], reactions: [3], ticks: 60, jobs: 2 });
    assert.equal(report.games.length, 8);
    for (const key of ['sourceHash', 'harnessHash', 'adversaryHash', 'frozenProxyHash', 'evaluatorHash', 'challengeSourceHash']) assert.match(report[key], /^[a-f0-9]{64}$/);
    const evaluator = await readFile(new URL('../tools/ai-evaluate.js', import.meta.url));
    assert.equal(report.evaluatorHash, createHash('sha256').update(evaluator).digest('hex'));
    const expectedHash = createHash('sha256').update([report.sourceHash, report.harnessHash, report.adversaryHash,
        report.frozenProxyHash, report.evaluatorHash].join(':')).digest('hex');
    assert.equal(report.challengeSourceHash, expectedHash);
    const frozen = JSON.parse(await readFile(new URL('../shared/ai/frozen-reactive-v1.json', import.meta.url), 'utf8'));
    assert.equal(report.adversaryHash, frozen['tools/reactive-player-proxy.js']);
    for (const summary of Object.values(report.comparisons['tactical-v5'].summary)) assert.equal(summary.meanDelta, 0);
    for (const cell of report.comparisons['tactical-v5'].cells) for (const sample of cell.paired.samples) for (const side of sample.sides) {
        assert.equal(report.games[side.candidateIndex].arm, 'candidate');
        assert.equal(report.games[side.referenceIndex].arm, 'reference');
        assert.equal(report.games[side.candidateIndex].game.fingerprint, report.games[side.referenceIndex].game.fingerprint);
    }
});

test('multiple candidates reuse the reference and typed proxy destruction remains separate from team loss', () => {
    const plan = buildChallengePlan({ candidates: ['tactical-v2', 'tactical-v1'], maps: ['1'], seeds: [7],
        adversaries: ['reactive-dodge'], modes: ['encounter'], levels: [4], reactions: [3], ticks: 60 });
    const games = plan.tasks.map(task => {
        const side = task.options.candidateSide, killed = task.arm === 'candidate' && task.version === 'tactical-v2';
        const metrics = Object.fromEntries([1, 2].map(team => [team, { kills: 0, playerKills: 0, botKills: 0,
            hits: 0, shots: 0, bonuses: 0, baseKills: 0 }]));
        if (killed) { metrics[side].kills = metrics[side].playerKills = 1; metrics[3 - side].kills = metrics[3 - side].botKills = 1; }
        return { map: task.options.map, mapHash: 'fixed-map', seed: task.options.seed, versions: task.options.versions,
            candidateSide: side, playerSide: 3 - side, winner: killed ? 3 - side : null,
            ending: killed ? 'victory' : 'timeout', ticks: 60, metrics,
            observations: { firstPlayerKillTick: killed ? 12 : null, candidateBotLosses: killed ? 1 : 0,
                pairActiveTicks: 0, twoAxisLineTicks: 0, twoAxisReadyTicks: 0 } };
    });
    const report = summarizeChallenges(plan, games);
    assert.equal(report.games.length, 6);
    const strong = report.comparisons['tactical-v2'].cells[0];
    assert.equal(strong.arms.candidate.score, 1);
    assert.equal(strong.arms.candidate.teamGame.wins, 0);
    assert.equal(strong.arms.candidate.teamGame.losses, 2);
    assert.equal(strong.arms.candidate.observations.meanKillTickWhenDestroyed, 12);
    assert.equal(strong.paired.meanDelta, 1);
    const control = report.comparisons['tactical-v1'].cells[0];
    assert.equal(control.arms.candidate.score, 0);
    assert.equal(control.arms.candidate.teamGame.timeouts, 2);
    assert.deepEqual(strong.paired.samples[0].sides.map(side => side.referenceIndex), [2, 5]);
    assert.deepEqual(control.paired.samples[0].sides.map(side => side.referenceIndex), [2, 5]);
});

test('a challenge worker failure closes running siblings before rejection', { timeout: 10000 }, async () => {
    const pool = new SimulationPool({ jobs: 2, workerURL });
    try {
        await assert.rejects(pool.run([{ ticks: 100000000 }, { adversary: 'unknown' }]),
            error => error.taskIndex === 1 && /Unknown adversary/.test(error.message));
        assert.equal(pool.workerCount, 0);
        assert.equal(pool.closed, true);
    } finally { await pool.close(); }
});
