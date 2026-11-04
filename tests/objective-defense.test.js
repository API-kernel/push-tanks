import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { TacticalV4 } from '../shared/ai/tactical-v4.js';
import { withObjectiveDefense, projectileThreatensBase } from '../shared/ai/objective-defense.js';

function arena() {
    const room = new GameRoom('SCREEN', null, [], { seed: 1, silent: true });
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    return room;
}
function tank(room, team, x, y) {
    const result = { id: room.enemyIdCounter++, team, x, y, width: 16, height: 16,
        speed: 1, direction: 'UP', level: 1, hp: 1, bulletSpeed: 2, bulletCooldownMax: 60, bulletTimer: 0 };
    room.enemies.push(result);
    return result;
}
test('base threat tracing honors intact fortifications and exact projectile geometry', () => {
    const room = arena(), home = room.teamManager.getAllBases().find(b => b.team === 1);
    const bullet = { x: 102, y: 144, direction: 'DOWN', speed: 4, width: 4, height: 4 };
    assert.equal(projectileThreatensBase(room, bullet, home), false);
    room.map[23][12] = 0; room.map[23][13] = 0;
    assert.equal(projectileThreatensBase(room, bullet, home), true);
    assert.equal(projectileThreatensBase(room, { ...bullet, x: 120 }, home), false);
});
test('one defender screens a shielded base attacker while another keeps fighting', () => {
    const room = arena();
    tank(room, 1, 64, 160); tank(room, 1, 128, 160); tank(room, 1, 0, 128);
    room.players.enemy = { id: 'enemy', team: 2, x: 96, y: 144, width: 16, height: 16,
        speed: 1, hp: 2, level: 4, direction: 'DOWN', shieldTimer: 100,
        get inputs() { throw Error('future input read'); } };
    const ai = new (withObjectiveDefense(TacticalV4))(room);
    ai.prepare();
    const tasks = room.enemies.map(b => ai.getTask(b.id));
    assert.equal(tasks.filter(t => t.screen).length, 1);
    assert.ok(tasks.some(t => ['defend', 'fight'].includes(t.kind)));
    const screen = tasks.find(t => t.screen);
    assert.equal(screen.target.y, 168);
});
test('a screen does not dodge a base-bound shell but still dodges other shells', () => {
    const room = arena(), bot = tank(room, 1, 96, 168);
    room.map[23][12] = 0; room.map[23][13] = 0;
    class RiskProbe {
        constructor() { this.room = room; this.reset(); }
        reset() { this.tasks = new Map(); }
        movementRisk(unit, direction, bullets) { return bullets.length * 10; }
    }
    const ai = new (withObjectiveDefense(RiskProbe))();
    ai.tasks.set(bot.id, { kind: 'guard', screen: true });
    const baseBound = { x: 102, y: 144, direction: 'DOWN', speed: 4, width: 4, height: 4 };
    assert.equal(ai.movementRisk(bot, null, [baseBound]), 0);
    assert.equal(ai.movementRisk(bot, null, [{ ...baseBound, x: 120 }]), 10);
    assert.equal(ai.movementRisk(bot, null, [{ ...baseBound, predicted: true }]), 10);
});
