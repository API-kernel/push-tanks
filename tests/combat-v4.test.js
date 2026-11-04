import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { TANK_STATS } from '../shared/config.js';
import { updateTankMovement } from '../shared/tank.js';
import { createBullet, updateBullets } from '../shared/bullet.js';
import { TacticalV3 } from '../shared/ai/tactical-v3.js';
import { TacticalCombatV4, withCombatV4 } from '../shared/ai/combat-v4.js';
import { TacticalNavigation } from '../shared/ai/navigation-controller.js';

function arena(bases = false) {
    const room = new GameRoom('COMBAT4', null, [], { seed: 901, silent: true });
    room.settings.botVersion = 'tactical-v1'; // The slot below holds the component under test.
    room.settings.basesEnabled = bases;
    room.settings.vibraniumBase = false;
    room.settings.botsReserve = { 1: 0, 2: 0 };
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    room.botAIs['tactical-v1'] = new TacticalCombatV4(room);
    return room;
}

function tank(room, team, x, y, extra = {}) {
    const stats = TANK_STATS.basic;
    const unit = { ...stats, id: room.enemyIdCounter++, team, x, y, width: 16, height: 16,
        direction: team === 1 ? 'UP' : 'DOWN', level: 1, baseHp: stats.hp,
        bulletCooldownMax: stats.bulletCooldown, bulletTimer: 0, shieldTimer: 0,
        isMoving: false, ...extra };
    room.enemies.push(unit);
    return unit;
}

function aimingTrial(AI) {
    const room = arena(), ai = new AI(room);
    const shooter = tank(room, 1, 96, 144, { bulletSpeed: 250 / 60 });
    const target = tank(room, 2, 84, 104, { hp: 1000, speed: 1 });
    let shots = 0, hits = 0;
    for (let tick = 0; tick < 720; tick++) {
        target.direction = Math.floor(tick / 48) % 2 ? 'LEFT' : 'RIGHT';
        // Match player/bot ordering: the observed target has already moved on
        // this tick and a newly fired shell advances before the next target step.
        updateTankMovement(target, target.direction, 208, 208, room.map, room.checkGlobalCollision.bind(room));
        ai.prepare();
        shooter.bulletTimer--;
        const shot = shooter.bulletTimer <= 0 ? ai.chooseShot(shooter) : null;
        if (shot) {
            shooter.direction = shot.direction;
            room.bullets.push(createBullet(shooter, shooter.bulletSpeed));
            shooter.bulletTimer = shooter.bulletCooldownMax;
            shots++;
        }
        room.bulletEvents = [];
        updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false);
        room.battleSystem.update();
        hits += room.bulletEvents.filter(event => event.type === 'TANK_HIT' && event.team === 1).length;
    }
    return { shots, hits };
}

test('firing-tick timing avoids repeatedly grazing a reversing target', () => {
    const old = aimingTrial(TacticalV3), candidate = aimingTrial(TacticalCombatV4);
    assert.ok(candidate.hits >= 7, 'repeated visible reversals should give useful hits');
    assert.ok(candidate.hits > old.hits + 3, 'the engine-timed forecast should beat the old one in this regression');
    assert.ok(candidate.hits / candidate.shots >= .8);
});

test('reversal forecasts require observed regular history and expire when overdue', () => {
    const room = arena(), target = tank(room, 2, 80, 48, { direction: 'RIGHT', isMoving: true });
    assert.ok(room.botAI.motionModels(target).every(model => !model.reverseAt));
    room.botAI.runs.set(target.id, { age: 20, direction: 'RIGHT', moving: true,
        periods: Array.from({ length: 4 }, () => ({ ticks: 24, reversal: true })) });
    const reversal = room.botAI.motionModels(target).find(model => model.reverseAt);
    assert.equal(reversal.reverseAt, 6);
    assert.ok(reversal.weight > .5);
    room.botAI.runs.get(target.id).age = 40;
    assert.ok(room.botAI.motionModels(target).every(model => !model.reverseAt));
});

test('occupied projectile capacity prevents a phantom future shot', () => {
    const room = arena(), bot = tank(room, 1, 80, 80);
    const target = tank(room, 2, 80, 16, { direction: 'DOWN' });
    delete target.bulletTimer;
    target.bulletCooldown = 0;
    target.level = 1;
    room.bullets.push({ x: 4, y: 8, direction: 'RIGHT', speed: 2, width: 4, height: 4,
        team: 2, ownerId: target.id });
    assert.equal(room.botAI.incoming(bot).filter(bullet => bullet.predicted).length, 0);
    room.bullets[0].isDead = true;
    assert.equal(room.botAI.incoming(bot).filter(bullet => bullet.predicted).length, 1);
});

test('a projectile slot becomes available after its visible shell hits cover', () => {
    const room = arena(), bot = tank(room, 1, 80, 80);
    const target = tank(room, 2, 80, 16, { direction: 'DOWN' });
    delete target.bulletTimer;
    target.bulletCooldown = 0;
    room.bullets.push({ x: 4, y: 8, direction: 'RIGHT', speed: 2, width: 4, height: 4,
        team: 2, ownerId: target.id });
    room.map[1][2] = { type: 2, mask: 15 };
    const predicted = room.botAI.incoming(bot).find(bullet => bullet.predicted);
    assert.ok(predicted);
    assert.ok(predicted.delay > 1, 'future fire must wait for the occupied slot');
});

test('clock freeze prevents predicted bot fire while existing shells remain dangerous', () => {
    const room = arena(), bot = tank(room, 1, 80, 80);
    tank(room, 2, 80, 16, { direction: 'DOWN' });
    room.effectTimers.clock = 30;
    room.effectTimers.clockTeam = 1;
    room.bullets.push({ x: 86, y: 60, direction: 'DOWN', speed: 4, width: 4, height: 4, team: 2 });
    const incoming = room.botAI.incoming(bot);
    assert.equal(incoming.filter(bullet => bullet.predicted).length, 0);
    assert.ok(room.botAI.movementRisk(bot, null, incoming) >= 400);
});

test('physical forecasts ignore player identity and never inspect input intentions', () => {
    const a = arena(), shooterA = tank(a, 1, 32, 48);
    tank(a, 2, 96, 48, { direction: 'DOWN', isMoving: true, speed: 1 });
    const b = arena(), shooterB = tank(b, 1, 32, 48);
    const target = tank(b, 2, 96, 48, { direction: 'DOWN', isMoving: true, speed: 1 });
    b.enemies.pop();
    b.players.human = { ...target, id: 'human',
        get inputs() { throw new Error('input intentions are private'); } };
    a.botAI.prepare();
    b.botAI.prepare();
    assert.deepEqual(a.botAI.chooseShot(shooterA), b.botAI.chooseShot(shooterB));
    const normalize = bullets => bullets.map(({ ownerId, ...bullet }) => bullet);
    assert.deepEqual(normalize(a.botAI.incoming(shooterA)), normalize(b.botAI.incoming(shooterB)));
    assert.equal(a.botAI.combatMovementCost(shooterA, 'DOWN'), b.botAI.combatMovementCost(shooterB, 'DOWN'));
});

test('shielded opponents cause range preservation instead of a rush into their firing axis', () => {
    const room = arena(), bot = tank(room, 1, 80, 96, { bulletTimer: 30 });
    tank(room, 2, 80, 48, { shieldTimer: 100, direction: 'DOWN' });
    const context = { task: { kind: 'fight' } };
    assert.ok(room.botAI.combatMovementCost(bot, 'LEFT', context)
        < room.botAI.combatMovementCost(bot, 'UP', context));
});

test('a shell threatening the base is intercepted even when it misses the defender', () => {
    const room = arena(true), bot = tank(room, 1, 80, 176);
    room.map = room.map.map(row => row.map(() => 0));
    room.bullets.push({ x: 102, y: 172, direction: 'DOWN', speed: 4, width: 4, height: 4,
        team: 2, ownerId: 900, ownerLevel: 1 });
    const shot = room.botAI.chooseShot(bot);
    assert.equal(shot?.intercept, true);
    assert.equal(shot.protectsBase, true);
    assert.equal(shot.direction, 'RIGHT');
    bot.direction = shot.direction;
    room.bullets.push(createBullet(bot, bot.bulletSpeed));
    for (let tick = 0; tick < 6; tick++) {
        updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false);
        room.battleSystem.update();
    }
    assert.equal(room.teamManager.getTeam(1).baseAlive, true);
    assert.ok(room.enemies.includes(bot));
});

test('base interception can be enabled without replacing aiming or movement policy', () => {
    const room = arena(true), bot = tank(room, 1, 80, 176);
    room.map = room.map.map(row => row.map(() => 0));
    const ai = new (withCombatV4(TacticalNavigation, { aim: false, baseDefense: true }))(room);
    room.bullets.push({ x: 102, y: 172, direction: 'DOWN', speed: 4, width: 4, height: 4,
        team: 2, ownerId: 900, ownerLevel: 1 });
    assert.equal(ai.chooseShot(bot).protectsBase, true);
    assert.equal(ai.combatMovementCost(bot, 'UP'), 0);
});

test('combat hooks preserve normal firing cooldown and chassis speed', () => {
    const room = arena(), bot = tank(room, 1, 80, 128, { bulletTimer: 10 });
    tank(room, 2, 80, 48, { bulletTimer: 999 });
    room.botAI.prepare();
    const speed = bot.speed;
    room.botAI.update(bot);
    assert.equal(room.bullets.length, 0);
    bot.bulletTimer = 0;
    room.botAI.update(bot);
    assert.equal(room.bullets.length, 1);
    assert.equal(bot.bulletTimer, bot.bulletCooldownMax);
    assert.equal(bot.speed, speed);
});

test('the aiming profile composes with a controller that has no combat-v3 state', () => {
    const room = arena();
    const Profile = withCombatV4(TacticalNavigation, { aim: true });
    const ai = new Profile(room);
    const bot = tank(room, 1, 80, 128, { bulletTimer: 0 });
    tank(room, 2, 80, 48, { bulletTimer: 999 });
    ai.prepare();
    assert.equal(ai.motion, undefined);
    assert.ok(ai.runs.size > 0);
    assert.equal(ai.chooseShot(bot).direction, 'UP');
    ai.update(bot);
    assert.equal(room.bullets.length, 1);
    ai.reset();
    assert.equal(ai.runs.size, 0);
});
