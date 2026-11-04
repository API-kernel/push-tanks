import { distance, shotAt, DIRECTIONS } from './geometry.js';
import { createTickField, physicalV6, weaponTiming } from './timing-path-v6.js';
import { bonusRouteV6 } from './resource-v6.js';

// Navigation-v2 remains byte-for-byte frozen. This optional planner supplies
// its public route state; normal movement, aiming and collision code execute it.
export function taskRouteV6(room, bot, task, field = createTickField(room, bot, { allowBreach: true })) {
    if (!task) return { ticks: Infinity, path: [] };
    if (task.kind === 'bonus') return bonusRouteV6(field, task.target);
    if (task.kind === 'guard') return field.best(point => distance(point, task.target) <= 4 ? 0 : Infinity);
    const timing = weaponTiming(bot), target = task.target, points = new Map();
    for (let coordinate = 0; coordinate <= 192; coordinate += 8) {
        for (const x of [Math.floor(target.x / 8) * 8 - 8, Math.floor(target.x / 8) * 8]) points.set(`${x}:${coordinate}`, { x, y: coordinate });
        for (const y of [Math.floor(target.y / 8) * 8 - 8, Math.floor(target.y / 8) * 8]) points.set(`${coordinate}:${y}`, { x: coordinate, y });
    }
    let best = { ticks: Infinity, path: [], score: Infinity };
    for (const p of points.values()) {
        const route = field.at(p);
        if (!Number.isFinite(route.ticks)) continue;
        for (const direction of Object.keys(DIRECTIONS)) {
            const shot = shotAt(room, { ...physicalV6(bot), ...p }, direction, target);
            if (!shot || shot.distance > (task.maxShotDistance ?? 104)) continue;
            // Full target-lane demolition is intentionally left to the combat
            // policy. This route estimate charges a conservative firing cycle.
            const penalty = (shot.breach ? timing.cooldown : 0)
                + (task.preferredRange === undefined ? shot.distance / 4 : Math.abs(shot.distance - task.preferredRange) / 2)
                + (task.approach ? distance(p, task.approach) / 2 : 0);
            if (route.ticks + penalty < best.score) best = { ...route, point: p, score: route.ticks + penalty };
        }
    }
    return best;
}

const taskKey = task => task ? `${task.kind}:${Math.round(task.target.x / 16)}:${Math.round(task.target.y / 16)}:${task.maxShotDistance || ''}:${task.approach?.x || ''}:${task.approach?.y || ''}` : '';
export function withTickPathV6(Base, { enabled = true, refreshTicks = 45, kinds = ['bonus', 'guard', 'attack', 'fight', 'defend'] } = {}) {
    return class TickPathV6 extends Base {
        reset() { super.reset(); this.tickPathsV6 = new Map(); }
        prepare() {
            super.prepare();
            const alive = new Set(this.room.enemies.map(bot => bot.id));
            for (const id of this.tickPathsV6.keys()) if (!alive.has(id)) this.tickPathsV6.delete(id);
        }
        update(bot) {
            const task = this.strategicTasks?.get(bot.id) || this.tasks.get(bot.id);
            if (enabled && task && kinds.includes(task.kind)) {
                let state = this.memory.get(bot.id);
                if (!state) { state = { path: [], planTick: -100, stuck: 0, escapeUntil: 0 }; this.memory.set(bot.id, state); }
                const key = taskKey(task), previous = this.tickPathsV6.get(bot.id), next = state.path[0];
                const disconnected = next && Math.abs(bot.x - next.x) > .05 && Math.abs(bot.y - next.y) > .05;
                if (this.tick >= (state.alignUntil || 0) && this.tick >= (state.escapeUntil || 0)
                    && (!previous || previous.key !== key || this.tick - previous.tick >= refreshTicks || state.stuck >= 10 || disconnected)) {
                    const route = taskRouteV6(this.room, bot, task);
                    this.tickPathsV6.set(bot.id, { key, tick: this.tick, ticks: route.ticks });
                    if (Number.isFinite(route.ticks)) {
                        state.path = route.path.length ? route.path : [{ x: bot.x, y: bot.y }];
                        state.routeTask = task; state.taskKey = key; state.planTick = this.tick; state.stuck = 0;
                    }
                }
            }
            return super.update(bot);
        }
    };
}
