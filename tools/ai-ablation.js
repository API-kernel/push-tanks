import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { buildEvaluationPlan, summarizeEvaluation } from './ai-evaluate.js';
import { runTournament, sourceHash } from './ai-benchmark.js';
import { cpuCapacity, validateJobs } from './ai-pool.js';

// Share the fixed reference arm between experiments. Never change its opponent
// or scenario just because a different component is being evaluated.
export async function runAblation({ candidates, reference = 'tactical-v5', opponent = 'tactical-v5',
    suite = 'quick', maps, seeds, ticks, jobs = cpuCapacity().defaultJobs, onProgress } = {}) {
    if (typeof candidates === 'string') candidates = candidates.split(',');
    if (!Array.isArray(candidates) || !candidates.length || new Set(candidates).size !== candidates.length) {
        throw new Error('candidates must be a nonempty list of unique registered policies');
    }
    if (maps === 'all') maps = (await readdir(new URL('../shared/maps/', import.meta.url)))
        .filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort();
    else if (typeof maps === 'string') maps = maps.split(',');
    if (typeof seeds === 'string') seeds = seeds.split(',').map(seed => seed.trim() ? Number(seed) : NaN);
    jobs = validateJobs(jobs);
    const plans = candidates.map(candidate => buildEvaluationPlan({ candidate, reference, opponent, suite, maps, seeds, ticks }));
    const referenceTasks = plans[0].tasks.filter(task => task.arm === 'reference');
    const tasks = referenceTasks.map(task => ({ ...task.options }));
    const labels = referenceTasks.map(task => ({ arm: 'reference', version: reference, cellId: task.cellId }));
    const offsets = new Map();
    for (const plan of plans) {
        const version = plan.config.candidate;
        if (version === reference) continue;
        offsets.set(version, tasks.length);
        for (const task of plan.tasks.filter(task => task.arm === 'candidate')) {
            tasks.push(task.options);
            labels.push({ arm: 'candidate', version, cellId: task.cellId });
        }
    }
    const [hash, runnerSource, evaluatorSource] = await Promise.all([sourceHash(),
        readFile(new URL('./ai-ablation.js', import.meta.url)), readFile(new URL('./ai-evaluate.js', import.meta.url))]);
    const runnerHash = createHash('sha256').update(runnerSource).digest('hex');
    const evaluatorHash = createHash('sha256').update(evaluatorSource).digest('hex');
    const started = performance.now();
    const results = await runTournament(tasks, { jobs, onProgress: event => onProgress?.({ ...event, label: labels[event.index] }) });
    const comparisons = {};
    for (const plan of plans) {
        let refIndex = 0, candidateIndex = offsets.get(plan.config.candidate) ?? 0;
        const games = plan.tasks.map(task => task.arm === 'reference' ? results[refIndex++] : results[candidateIndex++]);
        const { games: records, ...comparison } = summarizeEvaluation(plan, games);
        comparisons[plan.config.candidate] = { config: plan.config, ...comparison };
    }
    return { formatVersion: 1, config: { candidates, reference, opponent, suite, maps: plans[0].config.maps,
        seeds: plans[0].config.seeds, ticks: ticks ?? null }, sourceHash: hash, runnerHash, evaluatorHash, node: process.version,
        methodology: 'All candidates face the same fixed opponents/profiles. Reference games are simulated once and reused. Mirrored sides are averaged within map-seed units; descriptive deltas only. Encounter score uses typed player kills separately from team outcomes.',
        execution: { jobs: Math.min(jobs, tasks.length), requestedJobs: jobs, totalMs: performance.now() - started,
            simulatedGames: results.length, referenceGames: referenceTasks.length },
        comparisons, games: results.map((game, index) => ({ index, ...labels[index], game })) };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        console.log('node tools/ai-ablation.js --candidates policy-a,policy-b [--reference tactical-v5] [--opponent tactical-v5] [--suite quick|release|player|encounter] [--maps 1,7|all] [--seeds 21031,21043] [--ticks 7200] [--jobs N] [--output report.json]\nReference games are shared across candidates; old fixed player proxies remain unchanged. quick without --ticks uses 1800 ticks.');
        return;
    }
    const allowed = new Set(['candidates', 'reference', 'opponent', 'suite', 'maps', 'seeds', 'ticks', 'jobs', 'output']);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index].replace(/^--/, '');
        if (!args[index].startsWith('--') || !allowed.has(key) || !args[index + 1] || args[index + 1].startsWith('--') || key in options) throw new Error(`Invalid option: ${args[index]}`);
        options[key] = ['ticks', 'jobs'].includes(key) ? Number(args[index + 1]) : args[index + 1];
    }
    const { output, ...config } = options;
    const report = await runAblation({ ...config, onProgress: ({ completed, total, label }) => {
        if (completed % Math.max(1, Math.floor(total / 50)) === 0 || completed === total) console.error(`[${completed}/${total}] ${label.version} ${label.cellId}`);
    } });
    if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ output, execution: report.execution,
        summary: Object.fromEntries(Object.entries(report.comparisons).map(([version, report]) => [version, report.summary])) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
