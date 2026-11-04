import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { createBullet, updateBullets } from '../shared/bullet.js';
import { checkRectOverlap } from '../shared/utils.js';
import { baseLaneTimingV6 } from '../shared/ai/objective-timing-v6.js';

function arena(direction, { adjacent = false, level = 4, vibranium = false } = {}) {
    const room = new GameRoom('OBJECTIVE-GAP-V6', null, [], { seed: 37, silent: true });
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.settings.vibraniumBase = vibranium;
    room.resetGame();
    room.map = Array.from({ length: 26 }, () => Array(26).fill(0));
    const fixtures = {
        DOWN: { team: 2, x: 96, y: 64, cells: [[12, 12], [16, 12]], mask: 3 },
        UP: { team: 1, x: 96, y: 128, cells: [[12, 12], [8, 12]], mask: 3 },
        RIGHT: { team: 2, x: 16, y: 192, cells: [[24, 6], [24, 10]], mask: 5 },
        LEFT: { team: 2, x: 176, y: 192, cells: [[24, 16], [24, 14]], mask: 5 }
    };
    const fixture = fixtures[direction];
    const cells = adjacent ? fixture.cells.slice(0, 1) : fixture.cells;
    for (const [r, c] of cells) room.map[r][c] = {
        type: 1, mask: adjacent ? 15 : fixture.mask, isBaseWall: vibranium
    };
    const shooter = { id: 'attacker', team: fixture.team, x: fixture.x, y: fixture.y,
        width: 16, height: 16, direction, level, bulletSpeed: 4,
        bulletCooldownMax: 12, bulletCooldown: 0 };
    const base = room.teamManager.getAllBases().find(value => value.team !== shooter.team);
    return { room, shooter, base, cells };
}

function fire({ room, shooter, base }) {
    const bullet = createBullet(shooter, shooter.bulletSpeed), bullets = [bullet];
    for (let tick = 0; tick < 120; tick++) {
        updateBullets(bullets, room.map, 208, 208, room.teamManager,
            room.settings.vibraniumBase, () => .05);
        if (bullet.isDead) return false;
        if (checkRectOverlap(bullet, base)) return true;
    }
    assert.fail('fixture projectile did not reach a wall or base');
}

for (const direction of ['UP', 'DOWN', 'LEFT', 'RIGHT']) {
    test(`base timing counts separated wall planes as two real shots: ${direction}`, () => {
        const fixture = arena(direction);
        const estimate = baseLaneTimingV6(fixture.room, fixture.shooter, fixture.base);
        assert.equal(estimate.shots, 2);
        assert.equal(estimate.ticks, 24 + estimate.distance / fixture.shooter.bulletSpeed);
        assert.equal(fire(fixture), false);
        assert.equal(fixture.cells.filter(([r, c]) => fixture.room.map[r][c]?.mask).length, 1,
            'the first real blast must leave the separated wall intact');
        assert.equal(fire(fixture), false);
        assert.equal(fire(fixture), true, 'the final base hit needs its own shot');
    });
}

test('adjacent planes share only the real weapon destruction depth', () => {
    for (const level of [1, 4]) {
        const fixture = arena('DOWN', { adjacent: true, level });
        const estimate = baseLaneTimingV6(fixture.room, fixture.shooter, fixture.base);
        assert.equal(estimate.shots, level === 4 ? 1 : 2);
        for (let shot = 0; shot < estimate.shots; shot++) assert.equal(fire(fixture), false);
        assert.equal(fire(fixture), true);
    }
});

test('separated vibranium contacts retain separate expected damage cycles', () => {
    for (const adjacent of [false, true]) {
        const fixture = arena('DOWN', { adjacent, vibranium: true });
        const estimate = baseLaneTimingV6(fixture.room, fixture.shooter, fixture.base);
        assert.equal(estimate.shots, adjacent ? 10 : 20);
        // Force a successful vibranium hit without consuming the room RNG:
        // one success clears adjacent planes, but never the separated wall.
        assert.equal(fire(fixture), false);
        assert.equal(fixture.cells.filter(([r, c]) => fixture.room.map[r][c]?.mask).length,
            adjacent ? 0 : 1);
    }
});
