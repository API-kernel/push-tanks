import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { createBullet, updateBullets } from '../shared/bullet.js';
import { updateTankMovement } from '../shared/tank.js';
import { TacticalV5 } from '../shared/ai/tactical-v5.js';
import { withFireAvailability } from '../shared/ai/fire-availability-v6.js';
import { evaluateResponseAction, searchResponses, targetActsThisTick, withResponseSearch } from '../shared/ai/response-search-v6.js';

function fixture() {
    const room = new GameRoom('RESPONSE', null, [], { seed: 201, silent: true });
    room.settings.basesEnabled = false;
    room.settings.botsReserve = { 1: 0, 2: 0 };
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    const bot = { id: 1000, team: 1, x: 80, y: 128, width: 16, height: 16, hp: 2,
        baseHp: 2, level: 4, speed: 1, direction: 'UP', isMoving: false,
        bulletSpeed: 250 / 60, bulletCooldownMax: 12, bulletTimer: 0, shieldTimer: 0 };
    const target = { id: 'target', team: 2, x: 80, y: 48, width: 16, height: 16, hp: 2,
        level: 4, speed: 1, direction: 'DOWN', isMoving: true,
        bulletCooldown: 999, shieldTimer: 0, isDead: false, isSpawning: false, inputs: {} };
    room.enemies.push(bot);
    room.players.target = target;
    return { room, bot, target };
}
const action = { move: null, fire: 'UP' };
const continuation = { direction: 'DOWN', at: Infinity };

test('bounded joint search reduces the modeled safe answers without demanding a guaranteed hit', () => {
    const { room, bot, target } = fixture();
    const before = JSON.stringify([room.enemies, room.players, room.map, room.bullets]);
    const search = searchResponses(room, bot, target,
        { baseline: action, horizon: 20, maxTransitions: 3000 });
    assert.deepEqual([search.best.move, search.best.fire], ['UP', 'UP']);
    assert.ok(search.best.safeResponses < search.baseline.safeResponses);
    assert.ok(search.best.safeResponses > 0, 'a possible escape must not force endless waiting');
    assert.ok(search.transitions <= 3000);
    assert.equal(JSON.stringify([room.enemies, room.players, room.map, room.bullets]), before);
});

test('the physical continuation and response outcomes match the real projectile/battle loop', () => {
    for (const response of [continuation, { direction: 'LEFT', at: 2 }]) {
        const { room, bot, target } = fixture();
        const predicted = evaluateResponseAction(room, bot, target, action, response, { horizon: 20, commitTicks: 4 });
        const hp = target.hp;
        for (let tick = 1; tick <= 20; tick++) {
            // The player is already observed after its turn at tick1.
            if (tick > 1) {
                const direction = tick >= response.at ? response.direction : target.direction;
                target.inputs = { up: direction === 'UP', down: direction === 'DOWN',
                    left: direction === 'LEFT', right: direction === 'RIGHT', fire: false };
                room.updatePlayer(target);
            }
            updateTankMovement(bot, null, 208, 208, room.map, room.checkGlobalCollision.bind(room));
            if (tick === 1) {
                bot.direction = action.fire;
                room.bullets.push(createBullet(bot, bot.bulletSpeed));
            }
            updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false);
            room.battleSystem.update();
        }
        assert.equal(predicted.targetDamage, hp - target.hp);
        assert.equal(predicted.targetDamage, response.at === 2 ? 0 : 1);
    }
});

test('target tick1 follows player/enemy phase and enemy order instead of a global one-tick shift', () => {
    const { room, bot, target } = fixture();
    target.direction = 'RIGHT';
    const response = { direction: 'RIGHT', at: Infinity };
    const options = { horizon: 1, commitTicks: 1 };
    assert.equal(targetActsThisTick(room, bot, target), false);
    assert.equal(evaluateResponseAction(room, bot, target, action, response, options).firstTargetPosition.x, target.x);
    delete room.players.target;
    target.id = 1001;
    target.bulletTimer = 999;
    room.enemies.push(target);
    assert.equal(targetActsThisTick(room, bot, target), true);
    assert.equal(evaluateResponseAction(room, bot, target, action, response, options).firstTargetPosition.x, target.x + target.speed);
    room.enemies.reverse();
    assert.equal(targetActsThisTick(room, bot, target), false);
    assert.equal(evaluateResponseAction(room, bot, target, action, response, options).firstTargetPosition.x, target.x);
});

test('the muzzle is spawned after real movement, including waypoint speed clipping', () => {
    const { room, bot, target } = fixture();
    const waypoint = { x: 80, y: 127.75 };
    const prediction = evaluateResponseAction(room, bot, target, { move: 'UP', fire: 'UP' }, continuation,
        { horizon: 1, commitTicks: 1, waypoint });
    const preMovement = createBullet(bot, bot.bulletSpeed);
    const real = { ...bot, speed: .25 };
    updateTankMovement(real, 'UP', 208, 208, room.map, room.checkGlobalCollision.bind(room));
    const projectile = createBullet(real, bot.bulletSpeed);
    assert.deepEqual(prediction.muzzle, { x: projectile.x, y: projectile.y });
    assert.notEqual(prediction.muzzle.y, preMovement.y);
});

test('the search retains existing real-bullet risk and a strict transition budget', () => {
    const { room, bot, target } = fixture();
    const search = searchResponses(room, bot, target, { baseline: action, maxTransitions: 600,
        movementRisk: direction => direction === 'UP' ? 650 : 0 });
    assert.ok(search.transitions <= 600);
    assert.ok(search.actions.every(result => result.move !== 'UP' || result.score <= -1000));
    const empty = searchResponses(room, bot, target, { maxTransitions: 1 });
    assert.equal(empty.best, null);
    assert.equal(empty.transitions, 0);
});

test('no input intentions are inspected and ordinary cooldowns prevent extra counterfire', () => {
    const { room, bot, target } = fixture();
    Object.defineProperty(target, 'inputs', { get() { throw Error('future input read'); } });
    assert.doesNotThrow(() => searchResponses(room, bot, target, { maxTransitions: 300 }));
    const prediction = evaluateResponseAction(room, bot, target, action, continuation, { horizon: 20, commitTicks: 4 });
    assert.equal(prediction.ownDamage, 0);
});

class SteadyAim extends TacticalV5 {
    chooseShot() { return this.emergency ? { direction: 'LEFT', score: 200, intercept: true } : { direction: 'UP', score: 100 }; }
    incoming() { return []; }
    movementRisk() { return 0; }
    combatMovementCost() { return 0; }
}

test('the mixin has a short commitment, per-tick search cap, and preserves emergency/base screens', () => {
    const { room, bot } = fixture();
    const Profile = withResponseSearch(SteadyAim,
        { horizon: 20, maxDistance: 96, maxTransitions: 3000, maxSearchesPerTick: 1 });
    const ai = new Profile(room), task = { kind: 'fight' };
    ai.tick = 1;
    assert.equal(ai.chooseShot(bot, task).responseSearch, true);
    assert.equal(ai.combatMovementCost(bot, 'UP', { task }), 0);
    assert.ok(ai.combatMovementCost(bot, null, { task }) > 0);
    const second = { ...bot, id: 1002, x: 81 };
    room.enemies.push(second);
    ai.chooseShot(second, task);
    assert.equal(ai.responseBudget.count, 1);
    assert.equal(ai.responsePlans.has(second.id), false);
    ai.tick = 5;
    assert.equal(ai.combatMovementCost(bot, null, { task }), 0);
    ai.tick = 2;
    ai.emergency = true;
    assert.equal(ai.chooseShot(bot, task).intercept, true);
    assert.equal(ai.responsePlans.has(bot.id), false);
    ai.emergency = false;
    assert.equal(ai.chooseShot(bot, { kind: 'guard', screen: true }).responseSearch, undefined);
});

test('the response mixin composes above independent V6 availability without replacing its incoming data', () => {
    const { room, bot } = fixture();
    const Base = withFireAvailability(TacticalV5);
    const ai = new (withResponseSearch(Base))(room), control = new Base(room);
    ai.prepare(); control.prepare();
    assert.deepEqual(ai.incoming(bot), control.incoming(bot));
    assert.doesNotThrow(() => ai.chooseShot(bot, { kind: 'fight' }));
});
