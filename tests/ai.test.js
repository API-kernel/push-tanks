import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { TANK_STATS } from '../shared/config.js';
import { seededRandom } from '../shared/random.js';
import { updateEnemies } from '../shared/enemy.js';
import { shotAt } from '../shared/ai/geometry.js';
import { findPath, terrainCost } from '../shared/ai/navigation.js';
import { simulate, summarize } from '../tools/ai-benchmark.js';

function arena(bases = false) {
    const room = new GameRoom('TEST', null, [], { seed: 123, silent: true });
    room.settings.basesEnabled = bases;
    room.settings.vibraniumBase = false;
    room.settings.botsReserve = { 1: 0, 2: 0 };
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    return room;
}

function tank(room, team, x, y, extra = {}) {
    const stats = TANK_STATS.basic;
    const bot = { id: room.enemyIdCounter++, team, x, y, width: 16, height: 16,
        direction: team === 1 ? 'UP' : 'DOWN', speed: stats.speed, hp: stats.hp,
        baseHp: stats.hp, level: 1, bulletSpeed: stats.bulletSpeed,
        bulletCooldownMax: stats.bulletCooldown, bulletTimer: 0, shieldTimer: 0,
        isMoving: false, ...extra };
    room.enemies.push(bot);
    return bot;
}

test('seeded generators replay the same random sequence', () => {
    const a = seededRandom(42), b = seededRandom(42), c = seededRandom(43);
    const values = Array.from({ length: 100 }, a);
    assert.deepEqual(values, Array.from({ length: 100 }, b));
    assert.notDeepEqual(values, Array.from({ length: 100 }, c));
    assert.ok(values.every(v => v >= 0 && v < 1));
});

test('routing avoids steel/water but can plan a breach through bricks', () => {
    const room = arena(), bot = tank(room, 1, 32, 48);
    for (let r = 0; r < 16; r++) room.map[r][8] = { type: 2, mask: 15 };
    const task = { kind: 'bonus', target: { x: 96, y: 48 } };
    const path = findPath(room, bot, task);
    assert.ok(path.length > 0);
    assert.ok(path.some(p => p.y >= 128));
    assert.ok(path.every(p => Number.isFinite(terrainCost(room, bot, p))));
    room.map[6][4] = { type: 4, mask: 0 };
    assert.equal(terrainCost(room, bot, { x: 32, y: 48 }), Infinity);
    room.map[6][4] = { type: 1, mask: 15 };
    assert.ok(Number.isFinite(terrainCost(room, bot, { x: 32, y: 48 })));
});

test('steel becomes breachable only after collecting the gun upgrade', () => {
    const room = arena(), bot = tank(room, 1, 32, 48);
    room.map[6][8] = { type: 2, mask: 15 };
    assert.equal(shotAt(room, bot, 'RIGHT', { x: 96, y: 48 }), null);
    room.applyBonus(bot, 'gun');
    assert.equal(shotAt(room, bot, 'RIGHT', { x: 96, y: 48 }).breach, true);
});

test('aim uses micro-block geometry and does not shoot through intact cover', () => {
    const room = arena(), bot = tank(room, 1, 32, 48);
    const target = { x: 96, y: 48 };
    assert.equal(shotAt(room, bot, 'RIGHT', target).breach, false);
    room.map[7][8] = { type: 1, mask: 15 };
    assert.equal(shotAt(room, bot, 'RIGHT', target).breach, true);
    room.map[7][8].mask = 0;
    assert.equal(shotAt(room, bot, 'RIGHT', target).breach, false);
    assert.equal(shotAt(room, bot, 'LEFT', target), null);
});

test('human and bot with the same physical state have equal target priority', () => {
    const a = arena(), shooterA = tank(a, 1, 32, 48);
    tank(a, 2, 96, 48);
    const b = arena(), shooterB = tank(b, 1, 32, 48);
    const human = tank(b, 2, 96, 48);
    b.enemies.pop();
    b.players.human = { ...human, id: 'human', inputs: {}, nickname: 'HUMAN' };
    assert.deepEqual(a.botAI.chooseShot(shooterA), b.botAI.chooseShot(shooterB));
});

test('coordinator assigns a defender and only one bonus collector', () => {
    const room = arena(true);
    tank(room, 1, 64, 160);
    tank(room, 1, 160, 128);
    tank(room, 1, 32, 96);
    tank(room, 2, 64, 144);
    room.activeBonus = { x: 144, y: 104, type: 'star' };
    room.botAI.prepare();
    const jobs = room.enemies.filter(b => b.team === 1).map(b => room.botAI.getTask(b.id).kind);
    assert.equal(jobs.filter(j => j === 'bonus').length, 1);
    assert.equal(jobs.filter(j => j === 'defend').length, 1);
    assert.ok(jobs.some(j => j === 'attack' || j === 'fight'));
});

test('a direct base threat takes precedence over a nearby bonus', () => {
    const room = arena(true);
    const defender = tank(room, 1, 80, 160);
    tank(room, 2, 96, 160);
    room.activeBonus = { x: 64, y: 160, type: 'star' };
    room.botAI.prepare();
    assert.equal(room.botAI.getTask(defender.id).kind, 'defend');
});

test('own base walls are never a breach target', () => {
    const room = arena(true), bot = tank(room, 1, 80, 192);
    assert.equal(shotAt(room, bot, 'RIGHT', { x: 144, y: 192 }), null);
    assert.equal(terrainCost(room, bot, { x: 88, y: 192 }), Infinity);
});

test('bot attacks an exposed opposing base using real projectile physics', () => {
    const room = arena(true), bot = tank(room, 1, 64, 0);
    room.map[0][11] = { type: 0, mask: 0 };
    room.map[1][11] = { type: 0, mask: 0 };
    tank(room, 2, 184, 48, { bulletTimer: 99999 });
    room.effectTimers = { ...room.effectTimers, clock: 99999, clockTeam: 1 };
    for (let i = 0; i < 120 && !room.isGameOver; i++) room.update();
    assert.equal(room.winnerTeamId, bot.team);
    assert.equal(room.teamManager.getTeam(2).baseAlive, false);
});

test('incoming shells cause a perpendicular dodge before impact', () => {
    const room = arena(), bot = tank(room, 1, 80, 80, { bulletTimer: 999 });
    room.bullets.push({ x: 86, y: 8, direction: 'DOWN', speed: 4, team: 2, width: 4, height: 4 });
    const bullets = room.botAI.incoming(bot);
    assert.ok(room.botAI.movementRisk(bot, null, bullets) > 0);
    assert.equal(room.botAI.movementRisk(bot, 'LEFT', bullets), 0);
    room.botAI.update(bot);
    assert.notEqual(bot.x, 80);
});

test('an inaccessible base redirects an attacker toward a reachable opponent', () => {
    const room = arena(true), bot = tank(room, 1, 32, 144, { bulletTimer: 999 });
    tank(room, 2, 160, 64, { bulletTimer: 999 });
    for (let c = 0; c < 26; c++) room.map[4][c] = { type: 2, mask: 15 };
    room.botAI.prepare();
    const task = room.botAI.getTask(bot.id);
    assert.equal(task.kind, 'attack');
    assert.deepEqual(findPath(room, bot, task), []);
    room.botAI.update(bot);
    assert.ok(bot.isMoving);
});

test('bots respect cooldown and do not gain movement speed', () => {
    const room = arena(), bot = tank(room, 1, 32, 48, { bulletTimer: 10 });
    tank(room, 2, 96, 48, { bulletTimer: 999 });
    const speed = bot.speed;
    room.botAI.prepare();
    room.botAI.update(bot);
    assert.equal(room.bullets.length, 0);
    bot.bulletTimer = 0;
    room.botAI.update(bot);
    assert.equal(room.bullets.length, 1);
    assert.equal(bot.bulletTimer, TANK_STATS.basic.bulletCooldown);
    assert.equal(bot.speed, speed);
});

test('full game loop routes to and collects a bonus', () => {
    const room = arena(), bot = tank(room, 1, 32, 48, { bulletTimer: 999 });
    tank(room, 2, 184, 0, { bulletTimer: 999 });
    room.effectTimers = { ...room.effectTimers, clock: 99999, clockTeam: 1 };
    room.activeBonus = { x: 96, y: 48, width: 16, height: 16, type: 'star' };
    for (let i = 0; i < 240 && room.activeBonus; i++) room.update();
    assert.equal(room.activeBonus, null);
    assert.equal(bot.level, 2);
    assert.equal(bot.speed, TANK_STATS.basic.speed);
});

test('bot bonus effects upgrade weapons, shield and grant a team reserve', () => {
    const room = arena(), bot = tank(room, 1, 32, 48, { hp: 4, baseHp: 4 });
    room.applyBonus(bot, 'gun');
    assert.equal(bot.level, 4);
    assert.equal(bot.hp, 4);
    assert.ok(bot.bulletSpeed > TANK_STATS.basic.bulletSpeed);
    room.applyBonus(bot, 'helmet');
    assert.ok(bot.shieldTimer > 0);
    room.applyBonus(bot, 'tank');
    assert.equal(room.bonusReserves[1], 1);
    assert.equal(room.settings.botsReserve[1], 0);
});

test('clock freezes opposing bots for both policies', () => {
    for (const botVersion of ['legacy', 'tactical-v1']) {
        const room = arena();
        room.settings.botVersion = botVersion;
        const enemy = tank(room, 2, 64, 80, { bulletTimer: 5 });
        room.effectTimers.clock = 100;
        room.effectTimers.clockTeam = 1;
        updateEnemies(room);
        assert.deepEqual([enemy.x, enemy.y, enemy.bulletTimer], [64, 80, 5]);
    }
});

test('grenade affects opposing players and bots equally, preserving allies', () => {
    const room = arena(), collector = tank(room, 1, 32, 48), ally = tank(room, 1, 48, 48);
    tank(room, 2, 96, 48);
    room.players.human = { id: 'human', team: 2, x: 100, y: 100, lives: 1 };
    room.applyBonus(collector, 'grenade');
    assert.deepEqual(room.enemies, [collector, ally]);
    assert.equal(room.players.human.isDead, true);
    assert.equal(room.players.human.lives, 0);
});

test('map/base planning state is isolated between simultaneous rooms', () => {
    const a = arena(true), b = arena(true);
    b.rawMapData[12][12] = 2;
    b.resetGame();
    assert.equal(a.teamManager.useConcreteLid, true);
    assert.equal(b.teamManager.useConcreteLid, false);
    b.resetGame();
    a.teamManager.fortifyBase(1, false, a.map);
    assert.equal(a.map[23][12].type, 2);
});

test('a match with neither team alive ends in a draw', () => {
    const room = arena();
    room.update();
    assert.equal(room.isGameOver, true);
    assert.equal(room.winnerTeamId, null);
});

test('headless replay has identical physical states and metrics', async () => {
    const options = { map: '1', seed: 27, ticks: 480, tanks: 2, reserve: 3 };
    const a = await simulate(options), b = await simulate(options);
    assert.equal(a.fingerprint, b.fingerprint);
    assert.deepEqual(a.metrics, b.metrics);
    assert.equal(a.winner, b.winner);
    assert.equal(a.ticks, b.ticks);
    const summary = summarize([a, b], 'tactical-v1');
    assert.equal(summary.games, summary.wins + summary.losses + summary.draws);
});
