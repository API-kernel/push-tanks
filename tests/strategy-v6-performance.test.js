import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GameRoom } from '../game_room.js';
import { createTickField, strategyFields } from '../shared/ai/timing-path-v6.js';

function fixture() {
    const room = new GameRoom('FIELD-SNAPSHOT', null, [], { seed: 37, silent: true });
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.settings.vibraniumBase = true; room.resetGame();
    for (let r = 6; r < 20; r++) for (let c = 6; c < 20; c++) if ((r * 11 + c * 7) % 5 === 0) {
        room.map[r][c] = { type: (r + c) % 3 === 0 ? 2 : 1,
            mask: [15, 5, 10][(r + c) % 3], isBaseWall: (r + c) % 7 === 0 };
    }
    for (const [index, [team, level, x, y]] of [[1, 1, 8.25, 64], [1, 4, 8, 128], [2, 4, 176, 64.5], [2, 1, 176, 128]].entries()) {
        room.enemies.push({ id: 1000 + index, team, level, x, y, width: 16, height: 16,
            speed: 35 / 60, hp: 2, bulletSpeed: 125 / 60, bulletCooldownMax: 60, bulletTimer: 17 });
    }
    return room;
}

// Captured from commit 788d6e7 before performance changes. Hash every node's
// complete route, time, breach flag and expansion count, not only the winner.
const before = [
    '33ac7c626165e82fc879d711f2d575b24e63fbebc62b0e965b59f4bb02486fd2',
    '217433048bf72ad50052c5fef6a405106b2a0fe7a041289a945fce3d119e9a29',
    '02a71fbc557cf7f0fe41b16c64cb8a787a24b079854dcd5a50d069180e2494a4',
    '817e9e4d37f5d4132e3c7c17eb149a4a5adfa46b93f8136f2a9a869778fc80ae',
    '7dfe3f65ae45247bcf9ba5dbf1942bbe85cc7bfc8e13e9f52d46e899b7b0dd6c',
    'f4c0c2809f7f4483970f0c769b4f81862fde381c73cf6d9dc0c116e5fd15dd38',
    '659e3a5c1fb011047ddc573f7bc00dc41eb3853081721fe53e2fd18121cdb762',
    'cce87ec8a16bee5be2d05c17b310e0254585808e96475b22bbcaacf2411b4763'
];

test('shared terrain and cached blast edges preserve all pre-optimization routes', () => {
    const room = fixture(), controller = { room, tick: 8 };
    let index = 0;
    for (const bot of room.enemies) for (const allowBreach of [true, false]) {
        const field = strategyFields(controller, 'snapshot', 8, bot.team).get(bot, { allowBreach, crowd: false });
        const hash = createHash('sha256'); hash.update(String(field.expansions));
        for (let y = 0; y <= 192; y += 8) for (let x = 0; x <= 192; x += 8) {
            const p = { x, y }, route = field.at(p);
            assert.equal(field.ticksAt(p), route.ticks);
            hash.update(JSON.stringify(route));
        }
        assert.equal(hash.digest('hex'), before[index++]);
        for (const p of [{ x: -8, y: 0 }, { x: 200, y: 0 }, { x: 1, y: 0 }]) assert.equal(field.ticksAt(p), Infinity);
    }
    assert.equal(controller.strategyFieldsV6.get('snapshot').terrain.size, 5);
});

test('terrain sharing ends at the next strategy refresh after physical map changes', () => {
    const room = fixture(), controller = { room, tick: 8 }, bot = room.enemies[0];
    const first = strategyFields(controller, 'refresh', 8, 1).get(bot, { crowd: false });
    assert.ok(Number.isFinite(first.ticksAt({ x: 8, y: 80 })));
    for (let c = 0; c < 26; c++) room.map[10][c] = { type: 2, mask: 15 };
    controller.tick++;
    const next = strategyFields(controller, 'refresh', 8, 1).get(bot, { crowd: false });
    assert.notEqual(next, first);
    assert.equal(next.ticksAt({ x: 8, y: 80 }), Infinity);
    const standalone = createTickField(room, bot, { crowd: false });
    assert.deepEqual(next.at({ x: 8, y: 56 }), standalone.at({ x: 8, y: 56 }));
});
