import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GameRoom } from '../game_room.js';
import { PlayerProxy } from '../tools/player-proxy.js';
import { simulate } from '../tools/ai-benchmark.js';

test('released policies and fixed adversaries stay frozen for fair comparison', async () => {
    const directory = new URL('../shared/ai/', import.meta.url);
    const manifests = (await readdir(directory)).filter(file => /^frozen-.*\.json$/.test(file));
    for (const manifest of manifests) {
    const frozen = JSON.parse(await readFile(new URL(manifest, directory), 'utf8'));
    for (const [file, hash] of Object.entries(frozen)) {
        const actual = createHash('sha256').update(await readFile(new URL(`../${file}`, import.meta.url))).digest('hex');
        assert.equal(actual, hash, `${file} changed: introduce a new version instead`);
    }
    }
});

test('player proxy returns inputs without changing the physical world', () => {
    const room = new GameRoom('PROXY', null, [], { seed: 1, silent: true });
    room.rawMapData = Array.from({ length: 26 }, () => Array(26).fill(0));
    room.settings.basesEnabled = false;
    room.resetGame();
    room.addPlayer('P', 0, 'Proxy');
    const player = room.players.P_0;
    Object.assign(player, { x: 32, y: 48, isSpawning: false, shieldTimer: 0, direction: 'RIGHT' });
    room.enemies.push({ id: 1000, team: 2, x: 96, y: 48, width: 16, height: 16,
        hp: 1, speed: 1, direction: 'LEFT', bulletSpeed: 2, bulletTimer: 0 });
    const proxy = new PlayerProxy(room, player.id, { reaction: 1, policy: 'duelist' });
    const before = JSON.stringify([room.players, room.enemies, room.map, room.bullets]);
    const action = proxy.decide();
    assert.equal(JSON.stringify([room.players, room.enemies, room.map, room.bullets]), before);
    assert.equal(action.cheat0, false);
    assert.ok([action.up, action.down, action.left, action.right].filter(Boolean).length <= 1);
});

test('a scenario using real player physics is reproducible', async () => {
    const options = { map: '1', seed: 69, ticks: 600, tanks: 3, reserve: 4,
        players: 1, playerLevel: 4, playerPolicy: 'evasive', reaction: 6 };
    const a = await simulate(options), b = await simulate(options);
    assert.equal(a.fingerprint, b.fingerprint);
    assert.deepEqual(a.metrics, b.metrics);
    assert.equal(a.playerSide, 2);
    assert.ok(a.metrics[2].shots > 0);
});
