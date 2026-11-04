import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { TacticalCommander, weaponPower } from '../shared/ai/commander-v3.js';
import { TANK_STATS } from '../shared/config.js';

function arena() {
    const room = new GameRoom('COMMAND', null, [], { seed: 7, silent: true });
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    const commander = new TacticalCommander(room);
    return { room, commander };
}
function bot(room, team, x, y, extra = {}) {
    const result = { id: room.enemyIdCounter++, team, x, y, width: 16, height: 16,
        direction: team === 1 ? 'UP' : 'DOWN', hp: 1, speed: 35 / 60, level: 1,
        bulletSpeed: 125 / 60, bulletCooldownMax: 60, shieldTimer: 0, ...extra };
    room.enemies.push(result);
    return result;
}

test('commander keeps an attacking force instead of an idle permanent guard', () => {
    const { room, commander } = arena();
    bot(room, 1, 32, 160); bot(room, 1, 128, 160); bot(room, 1, 160, 160);
    bot(room, 2, 0, 0);
    commander.prepare();
    const tasks = room.enemies.filter(b => b.team === 1).map(b => commander.getTask(b.id));
    assert.ok(tasks.every(t => t.kind === 'attack'));
    assert.ok(new Set(tasks.map(t => t.approach.x)).size > 1);
});

test('an exposed base gets multiple defenders while keeping an attacker', () => {
    const { room, commander } = arena();
    bot(room, 1, 64, 160); bot(room, 1, 128, 160); bot(room, 1, 0, 128);
    bot(room, 2, 96, 160);
    for (const row of [23]) for (const col of [12, 13]) room.map[row][col] = 0;
    commander.prepare();
    const tasks = room.enemies.filter(b => b.team === 1).map(b => commander.getTask(b.id));
    assert.equal(tasks.filter(t => t.kind === 'defend').length, 2);
    assert.equal(tasks.length, 3);
});

test('a maximum-upgrade tank does not steal a weapon from an eligible ally', () => {
    const { room, commander } = arena();
    const upgraded = bot(room, 1, 64, 112, { level: 4 });
    const collector = bot(room, 1, 96, 144);
    room.activeBonus = { x: 64, y: 112, type: 'gun' };
    commander.prepare();
    assert.notEqual(commander.getTask(upgraded.id).kind, 'bonus');
    assert.equal(commander.getTask(collector.id).kind, 'bonus');
});

test('bots leave a nearby bonus to a friendly player already next to it', () => {
    const { room, commander } = arena();
    const automatic = bot(room, 1, 32, 144);
    room.players.ally = { id: 'ally', team: 1, x: 64, y: 112, isDead: false, isSpawning: false };
    room.activeBonus = { x: 64, y: 112, type: 'star' };
    commander.prepare();
    assert.notEqual(commander.getTask(automatic.id).kind, 'bonus');
});

test('weapon threat uses physical stats, not the control type', () => {
    const stats = TANK_STATS.player.levels[3];
    const automatic = { level: 3, bulletSpeed: stats.bulletSpeed, bulletCooldownMax: stats.cooldown };
    const player = { level: 3, inputs: {}, nickname: 'Human' };
    assert.equal(weaponPower(automatic), weaponPower(player));
});
