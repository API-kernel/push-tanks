import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../tools/ai-benchmark.js';
import { PlayerProxy } from '../tools/player-proxy.js';

test('instrumented proxy hooks preserve the fixed opponent and physical replay', async () => {
    const options = { map: '1', seed: 601, ticks: 300, tanks: 2, reserve: 3,
        versions: { 1: 'tactical-v5', 2: 'tactical-v5' }, candidateSide: 1,
        players: 1, playerPolicy: 'evasive', playerLevel: 4, reaction: 6 };
    const reference = await simulate(options);
    const factory = [], observed = [];
    const hooked = await simulate(options, {
        createPlayerProxy(room, id, config) {
            factory.push({ id, config });
            return new PlayerProxy(room, id, config);
        },
        observeTick({ room, elapsed, proxies }) {
            observed.push(elapsed);
            assert.equal(proxies.length, 1);
            assert.equal(proxies[0].room, room);
        },
    });
    assert.equal(hooked.fingerprint, reference.fingerprint);
    assert.deepEqual(hooked.metrics, reference.metrics);
    assert.deepEqual(factory, [{ id: 'PROXY_0', config: { policy: 'evasive', reaction: 6, index: 0, seed: 601 } }]);
    assert.deepEqual(observed, Array.from({ length: hooked.ticks }, (_, index) => index + 1));
});

test('a fixture configures ordinary rules before the configured map is reset', async () => {
    let configured = 0, observed = 0;
    const game = await simulate({ map: '1', seed: 7, ticks: 30 }, {
        configureRoom(room, config) {
            configured++;
            assert.equal(config.map, '1');
            assert.ok(room.rawMapData);
            room.settings.basesEnabled = false;
            room.settings.botsReserve[2] = 0;
        },
        observeTick({ room }) {
            observed++;
            assert.equal(room.teamManager.getAllBases().length, 0);
            assert.equal(room.settings.botsReserve[2], 0);
        },
    });
    assert.equal(configured, 1);
    assert.equal(observed, game.ticks);
});

test('invalid simulation hooks fail before loading a map', async () => {
    for (const hooks of [null, [], { configureRoom: true }, { createPlayerProxy: 1 }, { observeTick: 'invalid' }]) {
        await assert.rejects(simulate({ map: 'missing' }, hooks), TypeError);
    }
});
