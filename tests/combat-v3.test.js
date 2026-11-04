import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { TANK_STATS } from '../shared/config.js';
import { createBullet, updateBullets } from '../shared/bullet.js';
import { TacticalV2 } from '../shared/ai/tactical-v2.js';
import { TacticalCombat } from '../shared/ai/combat-v3.js';

function arena() {
    const room = new GameRoom('COMBAT', null, [], { seed: 123, silent: true });
    room.settings.basesEnabled = false;
    room.settings.botsReserve = { 1: 0, 2: 0 };
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    room.botAIs['tactical-v1'] = new TacticalCombat(room);
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

test('combat scores identical player and bot physical states equally and ignores future inputs', () => {
    const a = arena(), shooterA = tank(a, 1, 32, 48);
    tank(a, 2, 96, 48, { isMoving: true, direction: 'DOWN', speed: 1 });
    const b = arena(), shooterB = tank(b, 1, 32, 48);
    const human = tank(b, 2, 96, 48, { isMoving: true, direction: 'DOWN', speed: 1 });
    b.enemies.pop();
    b.players.human = { ...human, id: 'human', nickname: 'ANY',
        get inputs() { throw new Error('Future input intentions are private'); } };
    assert.deepEqual(a.botAI.chooseShot(shooterA), b.botAI.chooseShot(shooterB));
    const physical = bullets => bullets.map(({ ownerId, ...bullet }) => bullet);
    assert.deepEqual(physical(a.botAI.incoming(shooterA)), physical(b.botAI.incoming(shooterB)));
});

test('combat lead hits a target moving on the visible trajectory with real projectile timing', () => {
    const room = arena(), bot = tank(room, 1, 80, 128, { bulletSpeed: 250 / 60 });
    const target = tank(room, 2, 60, 64, { direction: 'RIGHT', speed: 1, isMoving: true, bulletTimer: 999 });
    const shot = room.botAI.chooseShot(bot);
    assert.equal(shot.direction, 'UP');
    bot.direction = shot.direction;
    room.bullets.push(createBullet(bot, bot.bulletSpeed));
    for (let tick = 0; tick < 40 && !target.isDead && room.enemies.includes(target); tick++) {
        room.botAI.movePreview(target, target.direction);
        updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false);
        room.battleSystem.update();
    }
    assert.ok(!room.enemies.includes(target), 'aimed projectile must kill the moving target');
});

test('observed frequent turns reduce the confidence of a long lateral lead', () => {
    const room = arena(), bot = tank(room, 1, 80, 128, { bulletSpeed: 250 / 60 });
    const target = tank(room, 2, 60, 64, { direction: 'RIGHT', speed: 1, isMoving: true, bulletTimer: 999 });
    room.botAI.motion.set(target.id, { direction: 'RIGHT', stable: 50, turnRate: .012 });
    const steady = room.botAI.chooseShot(bot);
    room.botAI.motion.set(target.id, { direction: 'RIGHT', stable: 1, turnRate: .09 });
    const turning = room.botAI.chooseShot(bot);
    assert.equal(steady.direction, turning.direction);
    assert.ok(steady.score > turning.score);
});

test('predicted shots respect observed cooldown and hard cover', () => {
    const room = arena(), bot = tank(room, 1, 80, 80);
    const target = tank(room, 2, 80, 16, { direction: 'DOWN', bulletTimer: 30 });
    assert.equal(room.botAI.incoming(bot).length, 0);
    target.bulletTimer = 0;
    const exposed = room.botAI.incoming(bot);
    assert.ok(room.botAI.trajectoryRisk({ ...bot }, null, exposed, 1, 28) > 0);
    room.map[6][10] = { type: 2, mask: 15 };
    room.map[6][11] = { type: 2, mask: 15 };
    const covered = room.botAI.incoming(bot);
    assert.equal(room.botAI.trajectoryRisk({ ...bot }, null, covered, 1, 28), 0);
});

test('a real shell behind a solid wall creates no dodge risk', () => {
    const room = arena(), bot = tank(room, 1, 80, 80);
    room.bullets.push({ x: 86, y: 8, direction: 'DOWN', speed: 4, team: 2, width: 4, height: 4 });
    room.map[6][10] = { type: 2, mask: 15 };
    room.map[6][11] = { type: 2, mask: 15 };
    assert.equal(room.botAI.movementRisk(bot, null, room.botAI.incoming(bot)), 0);
});

test('a short step remains legal when a later physical escape avoids the shell', () => {
    const room = arena(), bot = tank(room, 1, 80, 80, { speed: 1 });
    room.bullets.push({ x: 110, y: 8, direction: 'DOWN', speed: 4, team: 2, width: 4, height: 4 });
    const bullets = room.botAI.incoming(bot);
    const baseline = new TacticalV2(room);
    assert.ok(baseline.movementRisk(bot, 'RIGHT', baseline.incoming(bot)) > 0);
    assert.equal(room.botAI.movementRisk(bot, 'RIGHT', bullets), 0);
});

test('an impact during the short commitment still has a substantial risk', () => {
    const room = arena(), bot = tank(room, 1, 80, 80);
    room.bullets.push({ x: 86, y: 60, direction: 'DOWN', speed: 4, team: 2, width: 4, height: 4 });
    assert.ok(room.botAI.movementRisk(bot, null, room.botAI.incoming(bot)) >= 400);
});

test('shield protection expires at the predicted impact tick', () => {
    const room = arena(), bot = tank(room, 1, 80, 80, { shieldTimer: 6 });
    room.bullets.push({ x: 86, y: 60, direction: 'DOWN', speed: 4, team: 2, width: 4, height: 4 });
    const bullets = room.botAI.incoming(bot);
    assert.equal(room.botAI.trajectoryRisk({ ...bot }, null, bullets, 1, 6), 0);
    bot.shieldTimer = 2;
    assert.ok(room.botAI.trajectoryRisk({ ...bot }, null, bullets, 1, 6) >= 400);
});

test('a same-tick perpendicular interception uses the engine bullet-clash ordering', () => {
    const room = arena(), bot = tank(room, 1, 80, 80);
    room.bullets.push({ x: 82, y: 80, direction: 'RIGHT', speed: 4, team: 2,
        width: 4, height: 4, ownerId: 999, ownerLevel: 1 });
    const shot = room.botAI.chooseShot(bot);
    assert.equal(shot.intercept, true);
    assert.equal(shot.direction, 'UP');
    bot.direction = shot.direction;
    room.bullets.push(createBullet(bot, bot.bulletSpeed));
    updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false);
    room.battleSystem.update();
    assert.ok(room.bullets.every(b => b.isDead));
    assert.ok(room.enemies.includes(bot), 'projectile clash must protect the tank');
});
