import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

function optionalRead(read, path) {
    try { return read(path, 'utf8').trim(); } catch { return ''; }
}

// Affinity and a container's CPU budget can impose different limits. Check the
// current cgroup and its parents, since a parent may have the tighter quota.
export function cpuCapacity({ parallelism = availableParallelism(), read = readFileSync } = {}) {
    const v2 = new Set(['/sys/fs/cgroup']);
    const v1 = new Set(['/sys/fs/cgroup/cpu', '/sys/fs/cgroup/cpu,cpuacct', '/sys/fs/cgroup/cpuacct,cpu']);
    for (const line of optionalRead(read, '/proc/self/cgroup').split('\n')) {
        const [, controllers, path] = line.match(/^\d+:([^:]*):(.*)$/) || [];
        if (path === undefined) continue;
        const roots = controllers === '' ? ['/sys/fs/cgroup']
            : controllers.split(',').includes('cpu') ? [...v1] : [];
        for (const root of roots) {
            let directory = join(root, path);
            while (directory.startsWith(`${root}/`)) {
                (controllers === '' ? v2 : v1).add(directory);
                directory = dirname(directory);
            }
        }
    }
    const quotas = [];
    for (const directory of v2) {
        const [quota, period] = optionalRead(read, `${directory}/cpu.max`).split(/\s+/).map(Number);
        if (quota > 0 && period > 0) quotas.push(quota / period);
    }
    for (const directory of v1) {
        const quota = Number(optionalRead(read, `${directory}/cpu.cfs_quota_us`));
        const period = Number(optionalRead(read, `${directory}/cpu.cfs_period_us`));
        if (quota > 0 && period > 0) quotas.push(quota / period);
    }
    const cpuQuota = quotas.length ? Math.min(...quotas) : null;
    return { availableParallelism: parallelism, cpuQuota,
        defaultJobs: Math.max(1, Math.min(parallelism, cpuQuota === null ? parallelism : Math.floor(cpuQuota))) };
}

export function validateJobs(jobs) {
    if (!Number.isSafeInteger(jobs) || jobs < 1) throw new Error('jobs must be a positive integer');
    return jobs;
}

function workerError(details) {
    const error = new Error(details?.message || 'AI worker failed');
    if (details?.name) error.name = details.name;
    if (details?.stack) error.stack = details.stack;
    if (details?.code) error.code = details.code;
    return error;
}

// Each worker loads the simulation once and processes one game at a time. The
// task index, rather than completion order, determines the returned ordering.
export class SimulationPool {
    #workers = [];
    #run = null;
    #closed = false;
    #closing = null;
    #workerURL;

    constructor({ jobs = cpuCapacity().defaultJobs, workerURL = new URL('./ai-worker.js', import.meta.url) } = {}) {
        this.jobs = validateJobs(jobs);
        this.#workerURL = workerURL;
    }

    get workerCount() { return this.#workers.length; }
    get closed() { return this.#closed; }

    async run(tasks, { onProgress } = {}) {
        if (this.#closed) throw new Error('AI simulation pool is closed');
        if (this.#run) throw new Error('AI simulation pool already has a running tournament');
        if (!Array.isArray(tasks)) throw new TypeError('AI simulation tasks must be an array');
        if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function');
        if (!tasks.length) return [];
        return new Promise((resolve, reject) => {
            this.#run = { tasks: [...tasks], results: new Array(tasks.length), next: 0, completed: 0, onProgress, resolve, reject };
            try {
                while (this.#workers.length < Math.min(this.jobs, tasks.length)) this.#spawn();
                for (const state of this.#workers) this.#dispatch(state);
            } catch (error) { this.#fail(error); }
        });
    }

    #spawn() {
        const worker = new Worker(this.#workerURL, {
            // Parent flags from eval, a debugger, or the test runner may be
            // invalid for workers. Simulations need only the module's defaults.
            execArgv: [],
        });
        const state = { worker, index: null };
        this.#workers.push(state);
        worker.on('message', message => this.#receive(state, message));
        worker.on('error', error => this.#fail(error));
        worker.on('exit', code => {
            if (!this.#closed) this.#fail(new Error(`AI worker exited unexpectedly (code ${code})`));
        });
    }

    #dispatch(state) {
        const run = this.#run;
        if (!run || state.index !== null || run.next === run.tasks.length) return;
        state.index = run.next++;
        state.worker.postMessage({ id: state.index, config: run.tasks[state.index] });
    }

    #receive(state, message) {
        const run = this.#run;
        if (!run) return;
        if (!message || message.id !== state.index || state.index === null) {
            this.#fail(new Error('AI worker returned an unexpected task result'));
            return;
        }
        if (message.error) {
            const error = workerError(message.error);
            error.taskIndex = state.index;
            this.#fail(error);
            return;
        }
        const index = state.index;
        state.index = null;
        run.results[index] = message.result;
        run.completed++;
        try {
            run.onProgress?.({ completed: run.completed, total: run.tasks.length, index,
                task: run.tasks[index], result: message.result, jobs: Math.min(this.jobs, run.tasks.length) });
            if (run.completed === run.tasks.length) {
                this.#run = null;
                run.resolve(run.results);
            } else this.#dispatch(state);
        } catch (error) { this.#fail(error); }
    }

    #fail(error) {
        const run = this.#run;
        this.#run = null;
        this.close().then(() => run?.reject(error));
    }

    async close() {
        if (this.#closing) return this.#closing;
        this.#closed = true;
        const run = this.#run;
        this.#run = null;
        this.#closing = Promise.allSettled(this.#workers.map(({ worker }) => worker.terminate())).then(() => {
            this.#workers = [];
            run?.reject(new Error('AI simulation pool closed before the tournament completed'));
        });
        return this.#closing;
    }
}

export async function runTournament(tasks, options = {}) {
    const pool = new SimulationPool(options);
    try { return await pool.run(tasks, options); }
    finally { await pool.close(); }
}
