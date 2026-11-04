import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { TANK_STATS } from '../shared/config.js';
import { updateTankMovement } from '../shared/tank.js';
import { updateBullets } from '../shared/bullet.js';
import { canMoveTo } from '../shared/physics.js';
import { terrainCost, findPath } from '../shared/ai/navigation-v2.js';
import { terrainCost as oldTerrainCost } from '../shared/ai/navigation.js';
import { TacticalNavigation } from '../shared/ai/navigation-controller.js';

function arena(bases = false) {
    const room = new GameRoom('NAV', null, [], { seed: 101, silent: true });
    room.settings.basesEnabled = bases;
    room.settings.vibraniumBase = false;
    room.settings.botsReserve = { 1: 0, 2: 0 };
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    return room;
}
function tank(room, x, y, extra = {}) {
    const stats = TANK_STATS.basic;
    const bot = { id: room.enemyIdCounter++, team: 1, x, y, width: 16, height: 16,
        direction: 'UP', speed: stats.speed, hp: stats.hp, level: 1,
        bulletSpeed: stats.bulletSpeed, bulletCooldownMax: stats.bulletCooldown,
        bulletTimer: 999, shieldTimer: 0, isMoving: false, ...extra };
    room.enemies.push(bot);
    return bot;
}

test('destroyed numeric zero alongside remaining bricks stays breachable', () => {
    const room = arena(), bot = tank(room, 32, 48);
    room.map[6][4] = 0;
    room.map[6][5] = { type: 1, mask: 15 };
    assert.equal(oldTerrainCost(room, bot, bot), Infinity);
    assert.ok(Number.isFinite(terrainCost(room, bot, bot)));
    room.map[6][5] = { type: 2, mask: 15 };
    assert.equal(terrainCost(room, bot, bot), Infinity);
    bot.level = 4;
    assert.ok(Number.isFinite(terrainCost(room, bot, bot)));
});

test('fractional positions use exact 4px wall masks and the physical 14px hull', () => {
    const room = arena(), bot = tank(room, 69, 144);
    room.map[18][10] = { type: 2, mask: 2 };
    assert.equal(canMoveTo(bot.x, bot.y, room.map), true);
    assert.equal(terrainCost(room, bot, bot), 1);
    assert.equal(terrainCost(room, bot, { x: 72, y: 144 }), Infinity);
    bot.x = 69.25;
    assert.equal(canMoveTo(bot.x, bot.y, room.map), false);
    assert.equal(terrainCost(room, bot, bot), Infinity);
});

test('water with mask zero remains impassable', () => {
    const room = arena(), bot = tank(room, 32, 48);
    room.map[6][4] = { type: 4, mask: 0 };
    assert.equal(terrainCost(room, bot, bot), Infinity);
});

test('off-grid starts connect through real cardinal moves instead of rounding into steel', () => {
    const room = arena(), bot = tank(room, 69, 144);
    room.map[18][10] = { type: 2, mask: 2 };
    const path = findPath(room, bot, { kind: 'bonus', target: { x: 32, y: 144 } });
    assert.ok(path.length);
    const preview = { ...bot };
    for (const waypoint of path) {
        assert.ok(Math.abs(preview.x - waypoint.x) < .001 || Math.abs(preview.y - waypoint.y) < .001);
        for (let tick = 0; tick < 40 && Math.abs(preview.x - waypoint.x) + Math.abs(preview.y - waypoint.y) > .001; tick++) {
            const direction = preview.x !== waypoint.x ? (preview.x < waypoint.x ? 'RIGHT' : 'LEFT') : (preview.y < waypoint.y ? 'DOWN' : 'UP');
            const speed = preview.speed;
            preview.speed = Math.min(speed, Math.abs(preview.x - waypoint.x) + Math.abs(preview.y - waypoint.y));
            assert.equal(updateTankMovement(preview, direction, 208, 208, room.map, () => false), true);
            preview.speed = speed;
        }
        assert.equal(preview.x, waypoint.x);
        assert.equal(preview.y, waypoint.y);
    }
});

test('a fully sealed steel enclosure does not invent a start connector', () => {
    const room = arena(), bot = tank(room, 65, 65);
    for (let r = 6; r <= 12; r++) for (let c = 6; c <= 12; c++) {
        if (r === 6 || r === 12 || c === 6 || c === 12) room.map[r][c] = { type: 2, mask: 15 };
    }
    assert.deepEqual(findPath(room, bot, { kind: 'bonus', target: { x: 160, y: 160 } }), []);
});

test('full projectile and movement physics breach a partly destroyed barrier', () => {
    const room = arena(), bot = tank(room, 32, 48, { bulletTimer: 0 });
    for (let r = 0; r < 26; r++) room.map[r][8] = r === 6 ? 0 : { type: 1, mask: 15 };
    const ai = new TacticalNavigation(room);
    ai.tasks.set(bot.id, { kind: 'bonus', target: { x: 96, y: 48 } });
    for (let tick = 0; tick < 400; tick++) {
        ai.tick++;
        if (bot.bulletTimer > 0) bot.bulletTimer--;
        ai.update(bot);
        updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false, room.random);
        if (bot.x >= 88) break;
    }
    assert.ok(bot.x >= 88, `tank remained at ${bot.x},${bot.y}`);
    assert.equal(bot.speed, TANK_STATS.basic.speed);
});

test('a blocked ally yields using legal movement and clears a shared lane', () => {
    const room = arena(), first = tank(room, 80, 80), second = tank(room, 80, 96);
    const ai = new TacticalNavigation(room);
    ai.tasks.set(first.id, { kind: 'bonus', target: { x: 80, y: 128 } });
    ai.tasks.set(second.id, { kind: 'bonus', target: { x: 80, y: 48 } });
    const speed = second.speed;
    for (let tick = 0; tick < 300; tick++) {
        ai.tick++;
        ai.update(first);
        ai.update(second);
    }
    assert.ok(first.y >= 112, `first tank remained at ${first.x},${first.y}`);
    assert.ok(second.y <= 64, `second tank remained at ${second.x},${second.y}`);
    assert.equal(second.speed, speed);
});

test('combat movement hook receives every considered action and can request a safe sidestep', () => {
    const room = arena(), bot = tank(room, 80, 80);
    class Sidestep extends TacticalNavigation {
        seen = new Set();
        combatMovementCost(bot, direction, context) {
            assert.ok('task' in context && 'waypoint' in context && 'bullets' in context);
            this.seen.add(direction);
            return direction === 'LEFT' ? 0 : 20;
        }
    }
    const ai = new Sidestep(room);
    ai.tasks.set(bot.id, { kind: 'bonus', target: { x: 80, y: 16 } });
    ai.tick++;
    ai.update(bot);
    assert.ok(bot.x < 80);
    assert.equal(ai.seen.size, 5);
});

test('smart alignment is allowed to enter a narrow opening without snapping back forever', () => {
    const room = arena(), bot = tank(room, 72, 64);
    room.map[7][10] = { type: 1, mask: 8 };
    const ai = new TacticalNavigation(room);
    ai.tasks.set(bot.id, { kind: 'bonus', target: { x: 72, y: 40 } });
    ai.memory.set(bot.id, { path: [{ x: 72, y: 56 }, { x: 72, y: 48 }], planTick: 1,
        taskKey: 'bonus:5:3:::', stuck: 0, escapeUntil: 0 });
    for (let tick = 0; tick < 80; tick++) { ai.tick++; ai.update(bot); }
    assert.ok(bot.y <= 48, `tank oscillated at ${bot.x},${bot.y}`);
});

test('navigation preserves hull, movement stats, hit points and physical fire cooldown', () => {
    const room = arena(), bot = tank(room, 32, 48, { bulletTimer: 10, hp: 4 });
    tank(room, 96, 48, { team: 2, bulletTimer: 999 });
    const ai = new TacticalNavigation(room);
    ai.tasks.set(bot.id, { kind: 'fight', target: { x: 96, y: 48 } });
    const before = { speed: bot.speed, width: bot.width, height: bot.height, hp: bot.hp, bulletSpeed: bot.bulletSpeed };
    ai.tick++;
    ai.update(bot);
    assert.equal(room.bullets.length, 0);
    bot.bulletTimer = 0;
    ai.update(bot);
    assert.equal(room.bullets.length, 1);
    assert.equal(bot.bulletTimer, bot.bulletCooldownMax);
    assert.deepEqual({ speed: bot.speed, width: bot.width, height: bot.height, hp: bot.hp, bulletSpeed: bot.bulletSpeed }, before);
});
