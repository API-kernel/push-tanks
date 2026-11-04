import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { updateEnemies } from '../shared/enemy.js';
import { updateBullets } from '../shared/bullet.js';
import { TacticalV2 } from '../shared/ai/tactical-v2.js';
import { TacticalCombat } from '../shared/ai/combat-v3.js';
import { TacticalV5 } from '../shared/ai/tactical-v5.js';
import { withFireAvailability, earliestPossibleRemoval, earliestPossibleAmmoSlot } from '../shared/ai/fire-availability-v6.js';

function fixture(Base = TacticalCombat, options) {
    const room = new GameRoom('AVAILABILITY', null, [], { seed: 81, silent: true });
    room.settings.basesEnabled = false;
    room.settings.botsReserve = { 1: 0, 2: 0 };
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    const bot = { id: 1000, team: 1, x: 80, y: 80, width: 16, height: 16, hp: 1,
        baseHp: 1, level: 1, speed: 35 / 60, direction: 'UP', bulletSpeed: 125 / 60,
        bulletTimer: 999, bulletCooldownMax: 60, shieldTimer: 0 };
    room.enemies.push(bot);
    room.addPlayer('P', 0, 'Public state');
    const player = room.players.P_0;
    Object.assign(player, { team: 2, x: 80, y: 16, level: 1, hp: 2, isDead: false,
        isSpawning: false, shieldTimer: 0, direction: 'DOWN', bulletCooldown: 0,
        inputs: { fire: true } });
    const ai = new (withFireAvailability(Base, options))(room);
    return { room, bot, player, ai, old: new Base(room) };
}

function occupied(room, player, extra = {}) {
    const bullet = { x: 0, y: 0, direction: 'RIGHT', speed: 125 / 60,
        width: 4, height: 4, team: player.team, ownerId: player.id, ownerLevel: 1, ...extra };
    room.bullets.push(bullet);
    return bullet;
}
const predicted = bullets => bullets.filter(bullet => bullet.predicted);
const firstEndpoint = bullet => bullet.trace ? bullet.trace.findIndex(Boolean) : bullet.delay + 1;

for (const Base of [TacticalV2, TacticalCombat]) {
    test(`${Base.name}: occupied ammo delays only the impossible predicted prefix`, () => {
        const { room, bot, player, ai, old } = fixture(Base, { capacity: true, clock: false });
        occupied(room, player);
        const before = JSON.stringify(room.bullets);
        const original = predicted(old.incoming(bot))[0];
        const repaired = predicted(ai.incoming(bot))[0];
        const earliest = earliestPossibleAmmoSlot(room, player);
        assert.ok(earliest > firstEndpoint(original));
        assert.ok(!repaired || firstEndpoint(repaired) >= earliest);
        if (repaired?.trace) {
            const shift = firstEndpoint(repaired) - firstEndpoint(original);
            assert.deepEqual(repaired.trace.slice(shift), original.trace.slice(0, original.trace.length - shift));
        }
        assert.deepEqual(ai.incoming(bot).filter(bullet => !bullet.predicted), old.incoming(bot).filter(bullet => !bullet.predicted));
        assert.equal(JSON.stringify(room.bullets), before);
    });

    test(`${Base.name}: clock pauses bot cooldown, retaining the old geometry after thaw`, () => {
        const { room, bot, player, ai, old } = fixture(Base, { capacity: false, clock: true });
        delete room.players[player.id];
        const enemy = { ...bot, id: 1001, team: 2, x: 80, y: 16, direction: 'DOWN',
            bulletTimer: 2, isMoving: true };
        room.enemies.push(enemy);
        room.effectTimers.clock = 4;
        room.effectTimers.clockTeam = 1;
        const original = predicted(old.incoming(bot))[0];
        const repaired = predicted(ai.incoming(bot))[0];
        assert.equal(repaired.delay, original.delay + 4);
        if (repaired.trace) assert.deepEqual(repaired.trace.slice(4), original.trace.slice(0, -4));
        const position = [enemy.x, enemy.y], cooldown = enemy.bulletTimer;
        updateEnemies(room);
        assert.deepEqual([enemy.x, enemy.y], position);
        assert.equal(enemy.bulletTimer, cooldown);
        assert.equal(room.bullets.filter(bullet => bullet.ownerId === enemy.id).length, 0);
        // No cached shift or fictitious movement survives early removal of clock.
        room.effectTimers.clock = 0;
        assert.deepEqual(ai.incoming(bot), old.incoming(bot));
    });
}

test('capacity and clock switches are independent and disabled repairs preserve predictions', () => {
    const state = fixture(TacticalCombat, { capacity: false, clock: true });
    occupied(state.room, state.player);
    assert.deepEqual(state.ai.incoming(state.bot), state.old.incoming(state.bot));
    const Disabled = withFireAvailability(TacticalCombat, { capacity: false, clock: false });
    assert.deepEqual(new Disabled(state.room).incoming(state.bot), state.old.incoming(state.bot));
    delete state.room.players[state.player.id];
    state.room.enemies.push({ ...state.bot, id: 1001, team: 2, x: 80, y: 16, bulletTimer: 0, direction: 'DOWN' });
    state.room.effectTimers.clock = 90;
    state.room.effectTimers.clockTeam = 1;
    const CapacityOnly = withFireAvailability(TacticalCombat, { capacity: true, clock: false });
    assert.deepEqual(new CapacityOnly(state.room).incoming(state.bot), state.old.incoming(state.bot));
    assert.equal(predicted(state.ai.incoming(state.bot)).length, 0);
});

test('clock never freezes a player weapon; one of two slots and dead shells remain available', () => {
    const { room, bot, player, ai, old } = fixture();
    room.effectTimers.clock = 90;
    room.effectTimers.clockTeam = 1;
    player.level = 3;
    occupied(room, player);
    assert.deepEqual(ai.incoming(bot), old.incoming(bot));
    occupied(room, player, { x: 0, y: 4 });
    assert.ok(earliestPossibleAmmoSlot(room, player) > 1);
    room.bullets[1].isDead = true;
    assert.deepEqual(ai.incoming(bot), old.incoming(bot));
});

for (const collision of ['wall', 'tank', 'bullet']) {
    test(`real ${collision} collision opens a player slot on the next update, not the collision tick`, () => {
        const { room, bot, player, ai } = fixture();
        const shell = occupied(room, player, { x: 120, y: 48, speed: 4 });
        if (collision === 'wall') room.map[6][16] = { type: 2, mask: 15 };
        if (collision === 'tank') room.enemies.push({ ...bot, id: 1002, x: 124, y: 48, shieldTimer: 10 });
        if (collision === 'bullet') room.bullets.push({ ...shell, x: 128, direction: 'LEFT', team: 1, ownerId: bot.id });
        const removal = collision === 'wall' ? 2 : 1;
        assert.equal(earliestPossibleRemoval(room, shell), removal);
        assert.equal(earliestPossibleAmmoSlot(room, player), removal + 1);
        assert.ok(firstEndpoint(predicted(ai.incoming(bot))[0]) >= removal + 1);
        for (let tick = 0; tick < removal; tick++) {
            room.updatePlayer(player);
            assert.equal(room.bullets.filter(bullet => bullet.ownerId === player.id).length, 1);
            updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false);
            room.battleSystem.update();
        }
        assert.equal(shell.isDead, true);
        room.updatePlayer(player);
        assert.equal(room.bullets.filter(bullet => bullet.ownerId === player.id && !bullet.isDead).length, 1);
        assert.ok(room.bulletEvents.some(event => event.type === 'PLAYER_FIRE'));
    });
}

test('crossing projectile sweeps do not invent an endpoint clash or an immediate freed slot', () => {
    const { room, player } = fixture();
    const shell = occupied(room, player, { x: 40, y: 48, speed: 8 });
    room.bullets.push({ ...shell, x: 48, y: 40, direction: 'DOWN', speed: 16, team: 1, ownerId: 900 });
    assert.ok(earliestPossibleRemoval(room, shell) > 1);
    updateBullets(room.bullets, room.map, 208, 208, room.teamManager, false);
    room.battleSystem.update();
    assert.equal(!!shell.isDead, false);
});

test('a reachable moving body/new hostile shot keeps a possible early slot opening', () => {
    const { room, bot, player } = fixture();
    bot.x = 132; bot.y = 48;
    const shell = occupied(room, player, { x: 120, y: 48, speed: 4 });
    assert.equal(earliestPossibleRemoval(room, shell), 1);
    assert.equal(earliestPossibleAmmoSlot(room, player), 2);
});

test('the V5 wrapper reads public state without inspecting future player inputs', () => {
    const { room, bot, player, ai } = fixture(TacticalV5);
    player.level = 4;
    Object.defineProperty(player, 'inputs', { get() { throw new Error('future inputs are private'); } });
    occupied(room, player);
    assert.doesNotThrow(() => ai.incoming(bot));
    assert.equal(room.players[player.id], player);
});
