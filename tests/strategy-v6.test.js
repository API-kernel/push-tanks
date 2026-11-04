import test from 'node:test';
import assert from 'node:assert/strict';
import { createBullet, updateBullets } from '../shared/bullet.js';
import { GameRoom } from '../game_room.js';
import { TacticalV5 } from '../shared/ai/tactical-v5.js';
import { withTeamV6 } from '../shared/ai/team-v6.js';
import { withObjectiveTimingV6, estimateBaseThreatV6 } from '../shared/ai/objective-timing-v6.js';
import { withResourceV6, bonusUtilityV6 } from '../shared/ai/resource-v6.js';
import { withTickPathV6 } from '../shared/ai/planner-v6.js';
import { createTickField } from '../shared/ai/timing-path-v6.js';
import { shotAt } from '../shared/ai/geometry.js';

function arena(bases = false) {
    const room = new GameRoom('STRATEGY-V6', null, [], { seed: 37, silent: true });
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.settings.basesEnabled = bases;
    room.settings.vibraniumBase = false;
    room.resetGame();
    room.map = Array.from({ length: 26 }, () => Array(26).fill(0));
    return room;
}
function tank(room, team, x, y, extra = {}) {
    const result = { id: room.enemyIdCounter++, team, x, y, width: 16, height: 16,
        speed: 1, hp: 1, baseHp: 1, level: 1, direction: 'UP', isMoving: true,
        shieldTimer: 0, bulletSpeed: 2, bulletCooldownMax: 60, bulletTimer: 0, ...extra };
    room.enemies.push(result); return result;
}
class Probe {
    constructor(room) { this.room = room; this.reset(); }
    reset() { this.tick = 0; this.tasks = new Map(); this.strategicTasks = new Map(); this.memory = new Map(); this.collectors = new Map(); }
    assignTasks() {
        this.tasks = new Map(this.room.enemies.map(bot => [bot.id, bot.probeTask || { kind: 'fight', target: { x: 96, y: 80 } }]));
        this.strategicTasks = new Map(this.tasks);
    }
}
const axis = direction => ['UP', 'DOWN'].includes(direction) ? 'vertical' : 'horizontal';

test('crossfire chooses a reachable perpendicular axis and retains the pair', () => {
    const room = arena(), hold = tank(room, 1, 32, 80), flank = tank(room, 1, 40, 112);
    const target = tank(room, 2, 96, 80, { level: 4, hp: 2, bulletSpeed: 4, bulletCooldownMax: 12 });
    const ai = new (withTeamV6(Probe))(room); ai.assignTasks();
    const holderTask = ai.tasks.get(hold.id), flankTask = ai.tasks.get(flank.id);
    assert.equal(holderTask.crossfireRole, 'hold'); assert.equal(flankTask.crossfireRole, 'flank');
    const holdShot = ['UP', 'DOWN', 'LEFT', 'RIGHT'].map(dir => shotAt(room, { ...hold, ...holderTask.target }, dir, target)).find(value => value && !value.breach);
    const flankShot = ['UP', 'DOWN', 'LEFT', 'RIGHT'].map(dir => shotAt(room, { ...flank, ...flankTask.target }, dir, target)).find(value => value && !value.breach);
    assert.notEqual(axis(holdShot.direction), axis(flankShot.direction));
    const pair = ai.crossfirePlansV6.get(1);
    ai.tick = 8; ai.assignTasks();
    assert.equal(ai.crossfirePlansV6.get(1), pair);
    assert.equal(ai.strategicTasks.get(flank.id), ai.tasks.get(flank.id));
    assert.ok(ai.strategyFieldsV6.get('crossfire').count <= 8);
});

test('crossfire protects the collector and every required defender', () => {
    const room = arena();
    tank(room, 1, 32, 80);
    const defender = tank(room, 1, 40, 112, { probeTask: { kind: 'defend', target: { x: 96, y: 80 } } });
    const collector = tank(room, 1, 56, 112, { probeTask: { kind: 'bonus', target: { x: 72, y: 112 } } });
    tank(room, 2, 96, 80, { level: 4, hp: 2 });
    const ai = new (withTeamV6(Probe))(room); ai.assignTasks();
    assert.equal(ai.tasks.get(defender.id).kind, 'defend'); assert.equal(ai.tasks.get(collector.id).kind, 'bonus');
    assert.equal(ai.crossfirePlansV6.size, 0);
});

test('crossfire does not invent a route into an enclosed perpendicular lane', () => {
    const room = arena(); tank(room, 1, 32, 80); tank(room, 1, 40, 112);
    tank(room, 2, 96, 80, { level: 4, hp: 2 });
    for (let r = 0; r < 26; r++) room.map[r][10] = { type: 2, mask: 15 };
    const ai = new (withTeamV6(Probe))(room); ai.assignTasks(); assert.equal(ai.crossfirePlansV6.size, 0);
});

test('timed defense rejects a trapped nearby threat and screens a farther open line', () => {
    const room = arena(true), home = room.teamManager.getAllBases().find(base => base.team === 1);
    const defender = tank(room, 1, 88, 168, { probeTask: { kind: 'defend', target: { x: 64, y: 160 } } });
    tank(room, 1, 0, 128);
    const near = tank(room, 2, 64, 160);
    const far = tank(room, 2, 96, 80, { level: 4, hp: 2, bulletSpeed: 4, bulletCooldownMax: 12, direction: 'DOWN' });
    for (let r = 19; r <= 22; r++) for (let c = 7; c <= 10; c++) {
        if (r === 19 || r === 22 || c === 7 || c === 10) room.map[r][c] = { type: 2, mask: 15 };
    }
    assert.equal(estimateBaseThreatV6(room, near, home, createTickField(room, near, { allowBreach: true })), null);
    const ai = new (withObjectiveTimingV6(Probe))(room); ai.assignTasks();
    assert.equal(ai.tasks.get(defender.id).screenThreatId, far.id);
    assert.ok(ai.tasks.get(defender.id).interceptTicks <= ai.tasks.get(defender.id).interceptDeadline + 4);
});

test('timed defense covers two distinct fatal approaches with two defenders', () => {
    const room = arena(true);
    const vertical = tank(room, 1, 96, 168, { probeTask: { kind: 'defend', target: { x: 96, y: 96 } } });
    const horizontal = tank(room, 1, 72, 192, { probeTask: { kind: 'defend', target: { x: 40, y: 192 } } });
    const attacker = tank(room, 1, 0, 128);
    tank(room, 2, 96, 96, { level: 4, hp: 2, bulletSpeed: 4, bulletCooldownMax: 12 });
    tank(room, 2, 40, 192, { level: 4, hp: 2, bulletSpeed: 4, bulletCooldownMax: 12 });
    const ai = new (withObjectiveTimingV6(Probe))(room); ai.assignTasks();
    const tasks = [vertical, horizontal].map(bot => ai.tasks.get(bot.id));
    assert.ok(tasks.every(task => task.timingScreen));
    assert.equal(new Set(tasks.map(task => task.screenThreatId)).size, 2);
    assert.equal(ai.tasks.get(attacker.id).kind, 'fight');
});

test('shield expiry permits a timely kill instead of a new sacrificial screen', () => {
    function decision(shieldTimer) {
        const room = arena(true);
        const defender = tank(room, 1, 96, 144, { bulletSpeed: 4, bulletCooldownMax: 12,
            probeTask: { kind: 'defend', target: { x: 96, y: 96 } } });
        tank(room, 1, 0, 128);
        tank(room, 2, 96, 96, { level: 4, hp: 1, bulletSpeed: 4, bulletCooldownMax: 12, shieldTimer });
        const ai = new (withObjectiveTimingV6(Probe))(room); ai.assignTasks(); return ai.tasks.get(defender.id);
    }
    assert.equal(decision(5).timingScreen, undefined);
    assert.equal(decision(100).timingScreen, true);
});

test('weapon bonuses heal an injured maximum-level tank under the real engine', () => {
    const room = arena(), injured = tank(room, 1, 64, 80, { level: 4, hp: 1, baseHp: 2 });
    room.activeBonus = { x: 72, y: 80, type: 'star' };
    assert.ok(bonusUtilityV6(room, injured, room.activeBonus) > 0);
    const ai = new (withResourceV6(Probe))(room); ai.assignTasks();
    assert.equal(ai.tasks.get(injured.id).kind, 'bonus');
    room.applyBonus(injured, 'star'); assert.equal(injured.hp, 2);
    assert.equal(bonusUtilityV6(room, injured, room.activeBonus), 0);
    injured.hp = 1; room.applyBonus(injured, 'gun'); assert.equal(injured.hp, 2);
});

test('resource assignment uses the real detour rather than the closest hull', () => {
    const room = arena(), trappedSide = tank(room, 1, 48, 80), reachable = tank(room, 1, 136, 80);
    for (let r = 0; r < 22; r++) room.map[r][8] = { type: 2, mask: 15 };
    room.activeBonus = { x: 80, y: 80, type: 'gun' };
    const ai = new (withResourceV6(Probe))(room); ai.assignTasks();
    assert.notEqual(ai.tasks.get(trappedSide.id).kind, 'bonus'); assert.equal(ai.tasks.get(reachable.id).kind, 'bonus');
});

test('clock values only tanks its engine effect can freeze; grenade values all live enemies', () => {
    const room = arena(), own = tank(room, 1, 32, 80);
    room.players.P = { id: 'P', team: 2, x: 96, y: 80, hp: 2, level: 4,
        get inputs() { throw Error('future input read'); } };
    assert.equal(bonusUtilityV6(room, own, { type: 'clock' }), 0);
    assert.ok(bonusUtilityV6(room, own, { type: 'grenade' }) > 0);
    tank(room, 2, 128, 80);
    assert.ok(bonusUtilityV6(room, own, { type: 'clock' }) > 0);
});

test('a clearly lost bonus race does not recall a fighter', () => {
    const room = arena(), own = tank(room, 1, 32, 80);
    tank(room, 2, 112, 80);
    room.activeBonus = { x: 96, y: 80, type: 'gun' };
    const ai = new (withResourceV6(Probe))(room); ai.assignTasks();
    assert.notEqual(ai.tasks.get(own.id).kind, 'bonus');
});

test('breach versus detour changes with cooldown, pending shot, power and vibranium', () => {
    const room = arena(), own = tank(room, 1, 32, 80), goal = { x: 96, y: 80 };
    for (let r = 9; r < 13; r++) room.map[r][8] = { type: 1, mask: 15, isBaseWall: true };
    const route = extra => createTickField(room, { ...own, ...extra }, { allowBreach: true }).at(goal);
    const slow = route({ bulletCooldownMax: 60 }), fast = route({ bulletCooldownMax: 12 });
    assert.equal(slow.breached, false); assert.equal(fast.breached, true); assert.ok(fast.ticks < slow.ticks);
    const power = route({ level: 4, bulletCooldownMax: 12 }); assert.ok(power.ticks < fast.ticks);
    assert.equal(route({ level: 4, bulletCooldownMax: 12, bulletTimer: 100 }).breached, false);
    room.settings.vibraniumBase = true;
    assert.equal(route({ level: 4, bulletCooldownMax: 12 }).breached, false);
});

test('fractional connectors never round through a sealed concrete partition', () => {
    const room = arena(), own = tank(room, 1, 40.25, 80);
    for (let r = 0; r < 26; r++) room.map[r][8] = { type: 2, mask: 15 };
    const field = createTickField(room, own);
    assert.equal(field.at({ x: 80, y: 80 }).ticks, Infinity);
    assert.ok(Number.isFinite(field.at({ x: 32, y: 80 }).ticks));
});

test('all four components compose over V5 without reading future inputs', () => {
    const room = arena(true);
    tank(room, 1, 32, 80); tank(room, 1, 40, 112); tank(room, 1, 88, 168);
    room.players.P = { id: 'P', team: 2, x: 96, y: 80, width: 16, height: 16,
        hp: 2, speed: 1, level: 4, bulletCooldown: 0, direction: 'DOWN', shieldTimer: 0,
        get inputs() { throw Error('future input read'); } };
    room.activeBonus = { x: 72, y: 112, type: 'gun' };
    const AI = withTickPathV6(withResourceV6(withObjectiveTimingV6(withTeamV6(TacticalV5))));
    const ai = new AI(room); ai.prepare();
    for (const bot of room.enemies) ai.update(bot);
    assert.ok(room.bullets.length > 0);
    assert.ok([...ai.tasks.values()].every(task => Number.isFinite(task.target.x) && Number.isFinite(task.target.y)));
});

test('disabled strategy flags reproduce V5 assignments', () => {
    const room = arena(true); tank(room, 1, 32, 80); tank(room, 1, 40, 112); tank(room, 2, 96, 80);
    const before = new TacticalV5(room); before.assignTasks();
    const AI = withResourceV6(withObjectiveTimingV6(withTeamV6(TacticalV5, { enabled: false }), { enabled: false }), { enabled: false });
    const after = new AI(room); after.assignTasks(); assert.deepEqual(after.tasks, before.tasks);
});


test('a crossfire holder fires a good ready shot while its partner is reloading', () => {
    const room = arena(), holder = tank(room, 1, 32, 80), flanker = tank(room, 1, 40, 112, { bulletTimer: 100 });
    tank(room, 2, 96, 80, { hp: 2, level: 4, isMoving: false, bulletSpeed: 4, bulletCooldownMax: 12 });
    const ai = new (withTeamV6(TacticalV5))(room); ai.prepare();
    assert.equal(ai.tasks.get(holder.id).crossfireRole, 'hold');
    ai.update(holder);
    assert.ok(room.bullets.some(bullet => bullet.ownerId === holder.id));
    assert.equal(holder.bulletTimer, holder.bulletCooldownMax);
    assert.equal(flanker.bulletTimer, 100);
});

test('the optional tick planner physically breaches or detours without changing cooldown', () => {
    function run(cooldown) {
        const room = arena(), own = tank(room, 1, 32, 80, { direction: 'RIGHT', bulletCooldownMax: cooldown });
        for (let r = 9; r < 13; r++) room.map[r][8] = { type: 1, mask: 15 };
        const ai = new (withTickPathV6(TacticalV5, { kinds: ['guard'] }))(room);
        const task = { kind: 'guard', target: { x: 96, y: 80 } };
        ai.tasks.set(own.id, task); ai.strategicTasks.set(own.id, task);
        const fireTicks = [], trajectory = [];
        for (let tick = 0; tick < 200; tick++) {
            ai.tick++; own.bulletTimer--; ai.update(own);
            if (room.bulletEvents.some(event => event.type === 'ENEMY_FIRE')) fireTicks.push(tick);
            room.bulletEvents = [];
            updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false);
            trajectory.push({ x: own.x, y: own.y });
            if (Math.abs(own.x - 96) + Math.abs(own.y - 80) <= 4) return { ticks: tick, fireTicks, trajectory };
        }
        assert.fail('physical route did not reach the guard point');
    }
    const fast = run(12), slow = run(60);
    assert.ok(fast.ticks < slow.ticks);
    assert.ok(fast.trajectory.every(point => point.y === 80));
    assert.ok(slow.trajectory.some(point => Math.abs(point.y - 80) >= 20));
    for (let i = 1; i < fast.fireTicks.length; i++) assert.ok(fast.fireTicks[i] - fast.fireTicks[i - 1] >= 12);
    for (let i = 1; i < slow.fireTicks.length; i++) assert.ok(slow.fireTicks[i] - slow.fireTicks[i - 1] >= 60);
});

test('a timed screen physically absorbs a base-bound shell under BattleSystem', () => {
    const room = arena(true), defender = tank(room, 1, 88, 168, { bulletTimer: 100 });
    tank(room, 1, 0, 128);
    const threat = tank(room, 2, 96, 80, { level: 4, hp: 2, bulletSpeed: 4, bulletCooldownMax: 12, direction: 'DOWN' });
    const ai = new (withObjectiveTimingV6(TacticalV5))(room); ai.prepare();
    assert.equal(ai.tasks.get(defender.id).timingScreen, true);
    room.bullets.push(createBullet(threat, 4));
    for (let tick = 0; tick < 40; tick++) {
        ai.tick++;
        if (room.enemies.includes(defender)) { defender.bulletTimer--; ai.update(defender); }
        updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false);
        room.battleSystem.update();
    }
    assert.ok(!room.teamManager.getAllBases().find(base => base.team === 1).isDead);
    assert.ok(!room.enemies.includes(defender));
});
