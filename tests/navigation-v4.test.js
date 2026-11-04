import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { TANK_STATS } from '../shared/config.js';
import { updateBullets } from '../shared/bullet.js';
import { canMoveTo } from '../shared/physics.js';
import { TacticalV3 } from '../shared/ai/tactical-v3.js';
import { NavigationV4, NavigationBreach, findBreachPosition, withNavigationV4 } from '../shared/ai/navigation-v4.js';

function corridor() {
    const room = new GameRoom('NAV4', null, [], { seed: 101, silent: true });
    room.settings.basesEnabled = false;
    room.settings.botsReserve = { 1: 0, 2: 0 };
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    for (let r = 0; r < 8; r++) {
        room.map[r][7] = { type: 2, mask: 15 };
        room.map[r][10] = { type: 2, mask: 15 };
    }
    room.map[7][9] = { type: 1, mask: 8 };
    const stats = TANK_STATS.basic;
    const bot = { id: 1000, team: 1, x: 64, y: 64, width: 16, height: 16,
        direction: 'UP', speed: stats.speed, hp: 1, level: 1, bulletSpeed: stats.bulletSpeed,
        bulletCooldownMax: stats.bulletCooldown, bulletTimer: 0, shieldTimer: 0, isMoving: false };
    room.enemies.push(bot);
    return { room, bot };
}

function run(Policy, ticks) {
    const { room, bot } = corridor(), ai = new Policy(room);
    ai.tasks.set(bot.id, { kind: 'bonus', target: { x: 64, y: 16 } });
    for (let tick = 0; tick < ticks; tick++) {
        ai.tick++;
        if (bot.bulletTimer > 0) bot.bulletTimer--;
        ai.update(bot);
        updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false, room.random);
    }
    return { room, bot, ai };
}

test('corner recovery finds a reachable muzzle position for a wall outside the central firing ray', () => {
    const { room, bot } = corridor();
    const recovery = findBreachPosition(room, bot, { x: 64, y: 56 });
    assert.ok(recovery);
    assert.equal(recovery.direction, 'UP');
    assert.ok(recovery.firePosition.x > bot.x);
    assert.ok(canMoveTo(recovery.firePosition.x, recovery.firePosition.y, room.map));
    assert.deepEqual([recovery.r, recovery.c, recovery.bit], [7, 9, 3]);
});

test('corner recovery clears a reproducible V3 navigation stall using real bullets and movement', () => {
    const old = run(TacticalV3, 360), improved = run(NavigationBreach, 360);
    assert.ok(old.bot.y >= 62, `baseline unexpectedly passed at ${old.bot.y}`);
    assert.equal(old.room.map[7][9].mask, 8);
    assert.ok(improved.bot.y <= 24, `recovery stalled at ${improved.bot.x},${improved.bot.y}`);
    assert.equal(improved.room.map[7][9], 0);
    assert.equal(improved.bot.speed, TANK_STATS.basic.speed);
    assert.deepEqual([improved.bot.width, improved.bot.height, improved.bot.hp], [16, 16, 1]);
});

test('corner recovery never offers steel breaches without the physical upgrade', () => {
    const { room, bot } = corridor();
    room.map[7][9] = { type: 2, mask: 8 };
    assert.equal(findBreachPosition(room, bot, { x: 64, y: 56 }), null);
    bot.level = 4;
    assert.ok(findBreachPosition(room, bot, { x: 64, y: 56 }));
});

test('adaptive commitment requests a closer legal goal after a stationary attack', () => {
    const { room, bot } = corridor(), ai = new NavigationV4(room);
    const task = { kind: 'attack', target: { x: 96, y: 0, width: 8, height: 8 }, maxShotDistance: 208 };
    ai.tasks.set(bot.id, task);
    ai.breachProgress.set(bot.id, { anchor: { x: bot.x, y: bot.y }, anchorTick: -180 });
    ai.tick = 1;
    ai.update(bot);
    assert.equal(ai.tasks.get(bot.id).maxShotDistance, 32);
    assert.equal(task.maxShotDistance, 208);
    assert.equal(bot.speed, TANK_STATS.basic.speed);
});


test('commitment mixin composes with an existing navigation policy without replacing its combat or coordination', () => {
    class BasePolicy extends TacticalV3 {
        chooseShot() { this.customCombatCalled = true; return null; }
        assignTasks() { this.customCoordinationCalled = true; }
    }
    const Policy = withNavigationV4(BasePolicy), { room, bot } = corridor(), ai = new Policy(room);
    ai.assignTasks();
    ai.tasks.set(bot.id, { kind: 'bonus', target: { x: 64, y: 16 } });
    ai.tick++;
    ai.update(bot);
    assert.equal(ai.customCoordinationCalled, true);
    assert.equal(ai.customCombatCalled, true);
});
