import { writeFile } from 'node:fs/promises';
import { sourceHash, summarize } from './ai-benchmark.js';
import { runTournament } from './ai-pool.js';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) options[args[i].replace(/^--/, '')] = args[i + 1];
const candidates = (options.candidates || 'combat-v4,tactical-v3,tactical-v2').split(',');
const suite = options.suite || 'proxy-train';
const jobs = Math.min(6, Number(options.jobs || 6));
const split = (name, fallback) => options[name] ? options[name].split(',') : fallback;
const tasks = [], labels = [];
const add = (candidate, baseline, map, seed, side, extra = {}) => {
    tasks.push({ map, seed, versions: { [side]: candidate, [3 - side]: baseline },
        ticks: Number(options.ticks || 7200), tanks: 4, reserve: 12, bases: true, vibranium: true,
        playerSide: 3 - side, ...extra });
    labels.push({ candidate, baseline, side, ...extra });
};
for (const candidate of candidates) {
    if (suite.startsWith('proxy')) {
        const training = suite === 'proxy-train';
        for (const policy of split('policies', training ? ['evasive', 'duelist'] : ['evasive', 'rusher'])) {
            for (const map of split('maps', training ? ['1', 'The_Void'] : ['7', '15', 'The_Void'])) {
                for (const seed of split('seeds', training ? [11, 17] : [29, 47]).map(Number)) for (const side of [1, 2]) {
                    add(candidate, 'tactical-v1', map, seed, side, {
                        players: 1, playerPolicy: policy, playerLevel: training ? 4 : seed === 29 ? 1 : 4,
                        playerLives: 4, reaction: training ? 6 : 3
                    });
                }
            }
        }
    } else if (suite === 'teams') {
        for (const baseline of split('baselines', ['tactical-v1', 'tactical-v2', 'tactical-v3'])) {
            if (candidate === baseline) continue;
            for (const map of split('maps', ['1', '7', '15', 'Bunker', 'The_Void'])) {
                for (const seed of split('seeds', [5, 6]).map(Number)) for (const side of [1, 2]) add(candidate, baseline, map, seed, side);
            }
        }
    } else throw new Error(`Unknown suite ${suite}`);
}
const hash = await sourceHash();
const games = await runTournament(tasks, { jobs, onProgress: ({ completed, total, index, result }) => {
    const label = labels[index];
    console.log(`${completed}/${total} ${label.candidate} ${label.baseline} ${label.playerPolicy || ''} ${result.map} seed=${result.seed} side=${label.side} ${result.winner === label.side ? 'WIN' : result.winner ? 'LOSS' : result.ending}`);
} });
const rows = games.map((game, index) => ({ ...game, experiment: labels[index] }));
const summary = Object.fromEntries(candidates.map(candidate => [candidate,
    summarize(rows.filter(game => game.experiment.candidate === candidate), candidate)]));
console.log(JSON.stringify(summary, null, 2));
await writeFile(options.output || `/home/dev/.codex/agentverse/outbox/combat4-${suite}.json`,
    JSON.stringify({ suite, sourceHash: hash, jobs, candidates, summary, games: rows }, null, 2) + '\n');
