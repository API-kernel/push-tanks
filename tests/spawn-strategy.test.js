import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { chooseTacticalSpawn } from '../shared/ai/spawn-strategy.js';

function arena() {
    const room = new GameRoom('SPAWN', null, [], { seed: 1, silent: true });
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    return room;
}
test('spawn strategy avoids allied occupancy and waits when every point is occupied', () => {
    const room = arena();
    const busy = [64, 128, 0, 192].map(x => ({ x, y: 192, team: 1 }));
    assert.equal(chooseTacticalSpawn(room, 1, busy, () => 0), null);
    busy.pop();
    assert.deepEqual(chooseTacticalSpawn(room, 1, busy, () => 0), { x: 192, y: 192 });
});
test('spawn strategy avoids an exposed enemy firing lane without reading its inputs', () => {
    const room = arena();
    const enemy = { id: 'opponent', team: 2, x: 64, y: 128, direction: 'DOWN',
        speed: 1, level: 1, get inputs() { throw Error('future input read'); } };
    room.players.opponent = enemy;
    assert.notEqual(chooseTacticalSpawn(room, 1, [], () => 0).x, 64);
});
test('spawn strategy reinforces an immediate flank threat from a nearby available point', () => {
    const room = arena();
    room.enemies.push({ id: 1000, team: 2, x: 168, y: 176, direction: 'LEFT', speed: 1, level: 1 });
    assert.deepEqual(chooseTacticalSpawn(room, 1, [], () => 0), { x: 192, y: 192 });
});
test('spawn strategy uses exactly one random draw and keeps points inside the rules', () => {
    const room = arena();
    let draws = 0;
    const point = chooseTacticalSpawn(room, 2, [], () => { draws++; return .9; });
    assert.equal(draws, 1);
    assert.ok([0, 64, 128, 192].includes(point.x));
    assert.equal(point.y, 0);
});
