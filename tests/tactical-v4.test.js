import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../game_room.js';
import { TacticalV4 } from '../shared/ai/tactical-v4.js';
import { TANK_STATS } from '../shared/config.js';

function fixture(opponent) {
    const room = new GameRoom('ADAPT', null, [], { seed: 1, silent: true });
    room.settings.basesEnabled = false;
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.resetGame();
    const bot = { id: 1000, team: 1, x: 32, y: 48, width: 16, height: 16, hp: 1,
        level: 1, speed: 35 / 60, bulletSpeed: 125 / 60, bulletCooldownMax: 60,
        bulletTimer: 0, direction: 'RIGHT', shieldTimer: 0 };
    room.enemies.push(bot);
    if (opponent) room.enemies.push({ id: 1001, team: 2, x: 96, y: 48, width: 16, height: 16,
        hp: 1, level: 1, speed: 1, direction: 'LEFT', bulletSpeed: 125 / 60, bulletCooldownMax: 60, ...opponent });
    return { room, bot, ai: new TacticalV4(room) };
}

test('ordinary weapons preserve strategic progress, rapid-fire weapons trigger advanced combat', () => {
    const { room, bot, ai } = fixture({});
    assert.equal(ai.advancedCombat(bot), false);
    room.enemies[1].bulletCooldownMax = 12;
    ai.tick++;
    assert.equal(ai.advancedCombat(bot), true);
});

test('physical equivalents receive the same combat mode regardless of control type', () => {
    const stats = TANK_STATS.player.levels[1];
    const a = fixture({ bulletCooldownMax: stats.cooldown, bulletSpeed: stats.bulletSpeed });
    const b = fixture();
    b.room.players.opponent = { id: 'opponent', team: 2, x: 96, y: 48, width: 16, height: 16,
        hp: 1, level: 1, speed: 1, direction: 'LEFT', get inputs() { throw Error('future input read'); } };
    assert.equal(a.ai.advancedCombat(a.bot), b.ai.advancedCombat(b.bot));
    assert.equal(a.ai.advancedCombat(a.bot), true);
    assert.doesNotThrow(() => { b.ai.prepare(); b.ai.chooseShot(b.bot); b.ai.incoming(b.bot); });
});

test('ordinary-weapon forecasts also exclude future input packets', () => {
    const { room, bot, ai } = fixture();
    room.players.opponent = { id: 'opponent', team: 2, x: 96, y: 48, width: 16, height: 16,
        hp: 1, level: 1, speed: 1, direction: 'LEFT', bulletSpeed: 125 / 60, bulletCooldownMax: 60,
        get inputs() { throw Error('future input read'); } };
    assert.equal(ai.advancedCombat(bot), false);
    assert.doesNotThrow(() => { ai.prepare(); ai.chooseShot(bot); ai.incoming(bot); });
});

test('mode hysteresis avoids flickering as an opponent crosses its range boundary', () => {
    const { room, bot, ai } = fixture({ bulletCooldownMax: 12 });
    assert.equal(ai.advancedCombat(bot), true);
    room.enemies[1].x = 192; room.enemies[1].y = 192;
    ai.tick = 10;
    assert.equal(ai.advancedCombat(bot), true);
    ai.tick = 31;
    assert.equal(ai.advancedCombat(bot), false);
});

test('prediction and navigation state are isolated between controller instances', () => {
    const a = fixture({ bulletCooldownMax: 12 }), b = fixture({});
    assert.equal(a.ai.advancedCombat(a.bot), true);
    assert.equal(b.ai.advancedCombat(b.bot), false);
    assert.notEqual(a.ai.combatModes, b.ai.combatModes);
    assert.notEqual(a.ai.breachProgress, b.ai.breachProgress);
});
