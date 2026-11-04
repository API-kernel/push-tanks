import { TacticalAI } from './tactical-v1.js';
import { TacticalV2 } from './tactical-v2.js';
import { TacticalV3 } from './tactical-v3.js';
import { EXPERIMENT_POLICIES } from './experiments.js';
import { TacticalV4, TacticalV4RandomSpawn } from './tactical-v4.js';
import { TacticalV5 } from './tactical-v5.js';

export const BOT_POLICIES = Object.freeze({ 'tactical-v1': TacticalAI, 'tactical-v2': TacticalV2, 'tactical-v3': TacticalV3,
    'tactical-v4': TacticalV4, 'tactical-v5': TacticalV5,
    'experiment-v4-random-spawn': TacticalV4RandomSpawn, ...EXPERIMENT_POLICIES });
export const BOT_VERSIONS = Object.freeze(['legacy', ...Object.keys(BOT_POLICIES)]);
export const DEFAULT_BOT_VERSION = 'tactical-v5';

export function botVersionFor(settings, team) {
    const version = settings.botVersions?.[team] || settings.botVersion;
    return BOT_VERSIONS.includes(version) ? version : DEFAULT_BOT_VERSION;
}
