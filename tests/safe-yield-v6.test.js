import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { TANK_STATS } from '../shared/config.js';
import { updateBullets } from '../shared/bullet.js';
import { TacticalV5 } from '../shared/ai/tactical-v5.js';
import { withSafeYieldV6 } from '../shared/ai/safe-yield-v6.js';

const SafeV5 = withSafeYieldV6(TacticalV5);
function arena(bases = false) {
    const room = new GameRoom('YIELD', null, [], { seed: 701, silent: true });
    room.settings.basesEnabled = bases;
    room.settings.vibraniumBase = false;
    room.settings.botsReserve = { 1: 0, 2: 0 };
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    return room;
}
function tank(room, x, y) {
    const stats = TANK_STATS.basic;
    const bot = { ...stats, id: room.enemyIdCounter++, team: 1, x, y, width: 16, height: 16,
        direction: 'UP', level: 1, baseHp: stats.hp, bulletCooldownMax: stats.bulletCooldown,
        bulletTimer: 999, shieldTimer: 0, isMoving: false };
    room.enemies.push(bot);
    return bot;
}
function escaping(ai, bot, direction = 'RIGHT') {
    ai.tasks.set(bot.id, { kind: 'guard', target: { x: 80, y: 32 } });
    ai.memory.set(bot.id, { path: [{ x: 80, y: 72 }], taskKey: 'guard:5:2:::',
        planTick: ai.tick, stuck: 0, escapeUntil: 60, escapeDirection: direction });
}
function projectile(room, extra = {}) {
    room.bullets.push({ x: 98, y: 70, direction: 'DOWN', speed: 250 / 60,
        width: 4, height: 4, team: 2, ownerId: 9000, ownerLevel: 4, ...extra });
}
function crossing(AI) {
    const room = arena(), bot = tank(room, 80, 80), ai = new AI(room);
    escaping(ai, bot);
    projectile(room);
    for (let tick = 0; tick < 12 && room.enemies.includes(bot); tick++) {
        ai.tick++;
        ai.update(bot);
        updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false, room.random);
        room.battleSystem.update();
    }
    return { room, bot, ai };
}

test('a new shell interrupts committed yielding before a real lethal hit', () => {
    const baseline = crossing(TacticalV5), fixed = crossing(SafeV5);
    assert.equal(baseline.room.enemies.includes(baseline.bot), false, 'the frozen V5 failure must stay reproducible');
    assert.equal(fixed.room.enemies.includes(fixed.bot), true);
    assert.equal(fixed.bot.hp, 1);
    assert.ok(fixed.bot.y < 80);
    assert.equal(fixed.ai.yieldInterruptions, 1);
    assert.equal(fixed.bot.speed, TANK_STATS.basic.speed);
});

test('safe yielding still clears two allied tanks from a shared lane', () => {
    const room = arena(), first = tank(room, 80, 80), second = tank(room, 80, 96), ai = new SafeV5(room);
    ai.tasks.set(first.id, { kind: 'bonus', target: { x: 80, y: 128 } });
    ai.tasks.set(second.id, { kind: 'bonus', target: { x: 80, y: 48 } });
    for (let tick = 0; tick < 300; tick++) { ai.tick++; ai.update(first); ai.update(second); }
    assert.ok(first.y >= 112, `first remained at ${first.x},${first.y}`);
    assert.ok(second.y <= 64, `second remained at ${second.x},${second.y}`);
    assert.equal(ai.yieldInterruptions, 0);
});

test('an intentional screen keeps its commitment to absorb a base-bound shell', () => {
    const room = arena(true), bot = tank(room, 96, 168), ai = new SafeV5(room);
    room.map[23][12] = 0; room.map[23][13] = 0;
    escaping(ai, bot, 'DOWN');
    ai.tasks.set(bot.id, { kind: 'guard', target: { x: 96, y: 168 }, screen: true });
    projectile(room, { x: 102, y: 144, speed: 4 });
    ai.tick++;
    ai.update(bot);
    assert.equal(ai.yieldInterruptions, 0);
    assert.ok(ai.memory.get(bot.id).escapeUntil > ai.tick);
});

test('predicted fire alone does not repeatedly cancel traffic manoeuvres', () => {
    const room = arena(), bot = tank(room, 80, 80), ai = new SafeV5(room);
    room.enemies.push({ ...bot, id: 2000, team: 2, x: 80, y: 16, direction: 'DOWN', bulletTimer: 0 });
    escaping(ai, bot);
    assert.ok(ai.incoming(bot).some(bullet => bullet.predicted));
    ai.tick++;
    ai.update(bot);
    assert.equal(ai.yieldInterruptions, 0);
    assert.ok(bot.x > 80);
});
