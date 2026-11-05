import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { RESPAWN_DELAY, TANK_STATS } from '../shared/config.js';

function arena(id = 'STARS', options = {}) {
    const room = new GameRoom(id, null, [], { seed: 123, silent: true, ...options });
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.settings.basesEnabled = false;
    room.resetGame();
    return room;
}

test('new rooms start ordinary players without stars', () => {
    const room = arena();
    room.addPlayer('P', 0, 'Player');
    assert.equal(room.settings.playerStartLevel, 1);
    assert.equal(room.players.P_0.level, 1);
    assert.equal(room.players.P_0.hp, 1);
});

for (const level of [1, 2, 3, 4]) {
    test(`${level - 1} starting stars survive match reset, real death, respawn and late join`, () => {
        const room = arena();
        room.addPlayer('P', 0, 'Player 1');
        room.addPlayer('P', 1, 'Player 2');
        const player = room.players.P_0;
        room.updateSettings({ playerStartLevel: level });
        assert.equal(player.level, 1, 'changing the room rule does not upgrade a living tank');
        room.resetGame();
        for (const p of Object.values(room.players)) {
            assert.equal(p.level, level);
            assert.equal(p.hp, TANK_STATS.player.levels[level].hp);
        }

        Object.assign(player, { x: 80, y: 80, isSpawning: false, shieldTimer: 0 });
        room.applyBonus(player, 'gun');
        assert.equal(player.level, 4);
        for (let hit = 0; hit < 2; hit++) {
            room.bullets.push({ x: 82, y: 82, width: 4, height: 4, team: 2, ownerId: 1000 });
            room.battleSystem.update();
        }
        assert.equal(player.isDead, true);
        assert.equal(player.lives, room.settings.startLives - 1);
        for (let tick = 0; tick < RESPAWN_DELAY; tick++) room.updatePlayer(player);
        assert.equal(player.isDead, false);
        assert.equal(player.isSpawning, true);
        assert.equal(player.level, level);
        assert.equal(player.hp, TANK_STATS.player.levels[level].hp);

        player.isSpawning = false;
        player.inputs.fire = true;
        for (let tick = 0; tick < 40; tick++) room.updatePlayer(player);
        const shots = room.bullets.filter(b => b.ownerId === player.id && !b.isDead);
        assert.equal(shots.length, TANK_STATS.player.levels[level].bulletCount);
        assert.ok(shots.every(b => b.ownerLevel === level && b.speed === TANK_STATS.player.levels[level].bulletSpeed));

        room.addPlayer('LATE', 0, 'Late join');
        assert.equal(room.players.LATE_0.level, level);
        assert.equal(room.players.LATE_0.hp, TANK_STATS.player.levels[level].hp);
        room.applyBonus(player, 'gun');
        player.hp = 0;
        room.resetGame();
        assert.equal(player.level, level);
        assert.equal(player.hp, TANK_STATS.player.levels[level].hp);
    });
}

test('invalid starting levels cannot replace the room rules or crash the room', () => {
    const room = arena();
    room.updateSettings({ playerStartLevel: 3 });
    const before = structuredClone(room.settings);
    for (const value of [0, 5, -1, 1.5, NaN, Infinity, '3', null, undefined, true, {}, []]) {
        assert.equal(room.updateSettings({ playerStartLevel: value, startLives: 99 }), false);
        assert.deepEqual(room.settings, before);
    }
    for (const update of [null, undefined, '3', 3, []]) {
        assert.equal(room.updateSettings(update), false);
        assert.deepEqual(room.settings, before);
    }
    assert.equal(room.updateSettings({ startLives: 5 }), true);
    assert.equal(room.settings.playerStartLevel, 3);
});

test('starting stars stay isolated between rooms and preserve the benchmark override', () => {
    const a = arena('A'), b = arena('B');
    a.updateSettings({ playerStartLevel: 4 });
    a.addPlayer('P', 0, 'A');
    b.addPlayer('P', 0, 'B');
    assert.equal(a.players.P_0.level, 4);
    assert.equal(b.players.P_0.level, 1);
    const historical = arena('BENCH', { playerStartLevel: 1 });
    historical.addPlayer('P', 0, 'Proxy');
    assert.equal(historical.players.P_0.level, 1);
    assert.throws(() => arena('INVALID', { playerStartLevel: 5 }), /playerStartLevel/);
});
