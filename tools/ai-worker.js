import { parentPort } from 'node:worker_threads';
import { simulate } from './ai-benchmark.js';

parentPort.on('message', async ({ id, config }) => {
    try { parentPort.postMessage({ id, result: await simulate(config) }); }
    catch (error) {
        parentPort.postMessage({ id, error: { name: error.name, message: error.message, stack: error.stack, code: error.code } });
    }
});
