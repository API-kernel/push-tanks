import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { TacticalV5 } from '../shared/ai/tactical-v5.js';
import { withResourceHealingV6, weaponBonusEffectV6 } from '../shared/ai/resource-healing-v6.js';

function arena(bases = true) {
    const room = new GameRoom('HEAL-V6', null, [], { seed: 43, silent: true });
    room.settings.basesEnabled = bases;
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame(); return room;
}
function tank(room, team, x, y, extra = {}) {
    const bot = { id: room.enemyIdCounter++, team, x, y, width: 16, height: 16,
        hp: 1, baseHp: 1, level: 1, speed: 1, bulletSpeed: 2, bulletCooldownMax: 60,
        bulletTimer: 0, direction: 'UP', isMoving: true, shieldTimer: 0, ...extra };
    room.enemies.push(bot); return bot;
}
const Healing = withResourceHealingV6(TacticalV5);

test('the healing-only variant preserves every ordinary V5 bonus assignment', () => {
    for (const type of ['star', 'gun', 'grenade', 'helmet', 'clock', 'shovel', 'tank']) {
        const room = arena();
        tank(room, 1, 48, 112); tank(room, 1, 112, 112, { level: 3, hp: 2, baseHp: 2 });
        tank(room, 1, 144, 112, { level: 4, hp: 2, baseHp: 2 }); tank(room, 2, 0, 0);
        room.activeBonus = { type, x: 80, y: 112 };
        const before = new TacticalV5(room), after = new Healing(room);
        before.assignTasks(); after.assignTasks();
        assert.deepEqual(after.tasks, before.tasks, type); assert.deepEqual(after.collectors, before.collectors, type);
    }
});

test('a damaged level-four tank can collect star or gun without replacing another V5 task', () => {
    for (const type of ['star', 'gun']) {
        const room = arena(), own = tank(room, 1, 64, 112, { level: 4, hp: 1, baseHp: 2 });
        const ally = tank(room, 1, 144, 112, { level: 4, hp: 2, baseHp: 2 }); tank(room, 2, 0, 0);
        room.activeBonus = { type, x: 80, y: 112 };
        const before = new TacticalV5(room), after = new Healing(room);
        before.assignTasks(); after.assignTasks();
        assert.notEqual(before.tasks.get(own.id)?.kind, 'bonus');
        assert.equal(after.tasks.get(own.id)?.kind, 'bonus');
        assert.deepEqual(after.tasks.get(ally.id), before.tasks.get(ally.id));
        assert.equal(after.strategicTasks.get(own.id), after.tasks.get(own.id));
        room.applyBonus(own, type); assert.equal(own.hp, 2);
    }
});

test('an injured maximum-level tank leaves the parent collector and its task distribution intact', () => {
    const room = arena(); tank(room, 1, 64, 112, { level: 4, hp: 1, baseHp: 2 });
    tank(room, 1, 144, 112); tank(room, 2, 0, 0);
    room.activeBonus = { type: 'star', x: 80, y: 112 };
    const before = new TacticalV5(room), after = new Healing(room); before.assignTasks(); after.assignTasks();
    assert.deepEqual(after.tasks, before.tasks); assert.deepEqual(after.collectors, before.collectors);
});

test('the healing-only variant retains V5 priority for an exposed home base', () => {
    const room = arena(); room.map = Array.from({ length: 26 }, () => Array(26).fill(0));
    tank(room, 1, 32, 112, { level: 4, hp: 1, baseHp: 2 }); tank(room, 1, 88, 168); tank(room, 1, 128, 168);
    room.players.enemy = { id: 'enemy', team: 2, x: 96, y: 80, width: 16, height: 16,
        level: 4, hp: 2, speed: 1, bulletSpeed: 4, bulletCooldown: 0, direction: 'DOWN', shieldTimer: 0,
        get inputs() { throw Error('future input read'); } };
    room.activeBonus = { type: 'gun', x: 48, y: 112 };
    const before = new TacticalV5(room), after = new Healing(room); before.assignTasks(); after.assignTasks();
    assert.deepEqual(after.tasks, before.tasks); assert.ok([...after.tasks.values()].every(task => task.kind !== 'bonus'));
});

test('the added repair collector keeps the existing 24-tick hysteresis', () => {
    const room = arena();
    const previous = tank(room, 1, 64, 112, { level: 4, hp: 1, baseHp: 2 });
    tank(room, 1, 80, 112, { level: 4, hp: 1, baseHp: 2 }); tank(room, 2, 0, 0);
    room.activeBonus = { type: 'star', x: 96, y: 112 };
    const ai = new Healing(room); ai.collectors.set(1, { id: previous.id, key: 'star:96:112' }); ai.assignTasks();
    assert.equal(ai.tasks.get(previous.id).kind, 'bonus');
});

test('weapon effect prediction matches the actual engine HP, power and cooldown', () => {
    const room = arena(false);
    const basic = tank(room, 1, 32, 80, { bulletSpeed: 125 / 60, bulletCooldownMax: 60 });
    const predicted = weaponBonusEffectV6(basic, 'star'); room.applyBonus(basic, 'star');
    assert.equal(predicted.cooldown, 12); assert.equal(predicted.cooldown, basic.bulletCooldownMax);
    assert.equal(predicted.bulletSpeed, basic.bulletSpeed); assert.equal(predicted.hp, basic.hp);
    const heavy = tank(room, 1, 64, 80, { level: 4, hp: 1, baseHp: 4 });
    const repair = weaponBonusEffectV6(heavy, 'gun'); room.applyBonus(heavy, 'gun');
    assert.equal(repair.healing, 3); assert.equal(repair.hp, heavy.hp); assert.equal(repair.steelUnlocked, false);
});

test('a healthy level-four tank and disabled repair option preserve V5 exactly', () => {
    const room = arena(); tank(room, 1, 64, 112, { level: 4, hp: 2, baseHp: 2 }); tank(room, 2, 0, 0);
    room.activeBonus = { type: 'star', x: 80, y: 112 };
    const before = new TacticalV5(room), after = new Healing(room); before.assignTasks(); after.assignTasks();
    assert.deepEqual(after.tasks, before.tasks);
    room.enemies[0].hp = 1;
    const disabled = new (withResourceHealingV6(TacticalV5, { enabled: false }))(room);
    before.assignTasks(); disabled.assignTasks(); assert.deepEqual(disabled.tasks, before.tasks);
});
