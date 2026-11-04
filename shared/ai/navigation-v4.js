import { TacticalV3 } from './tactical-v3.js';
import { DIRECTIONS, distance, firstWall, shotAt } from './geometry.js';
import { createBullet } from '../bullet.js';
import { canMoveTo } from '../physics.js';
import { checkRectOverlap } from '../utils.js';

// Experimental navigation hypotheses. Each option only changes public task
// goals; all movement, projectile creation and cooldowns use the existing engine.
export function withNavigationV4(Base) {
    return class NavigationCommitment extends Base {
    static navigationOptions = Object.freeze({ stallCommit: true });

    reset() {
        super.reset();
        this.breachProgress = new Map();
    }

    prepare() {
        super.prepare();
        const alive = new Set(this.room.enemies.map(bot => bot.id));
        for (const id of this.breachProgress.keys()) if (!alive.has(id)) this.breachProgress.delete(id);
    }

    chooseShot(bot, task, waypoint) {
        const best = super.chooseShot(bot, task, waypoint);
        const recovery = this.breachProgress.get(bot.id)?.recovery;
        if (!recovery || distance(bot, recovery.firePosition) > .05 || best?.intercept || best?.score >= 100) return best;
        const [dx, dy] = DIRECTIONS[recovery.direction];
        const shot = shotAt(this.room, bot, recovery.direction, { x: bot.x + dx * 48, y: bot.y + dy * 48, width: 16, height: 16 });
        return shot?.breach ? { ...shot, score: 60 } : best;
    }

    assignTasks() {
        super.assignTasks();
        const options = this.constructor.navigationOptions;
        for (const bot of this.room.enemies) {
            const task = this.tasks.get(bot.id);
            if (!task) continue;
            if (options.closeRange && ['attack', 'fight'].includes(task.kind)) {
                this.tasks.set(bot.id, { ...task, maxShotDistance: options.closeRange, preferredRange: 24 });
            }
            if (options.pushLane && task.kind === 'attack') {
                const state = this.breachProgress.get(bot.id) || { anchor: { x: bot.x, y: bot.y }, anchorTick: this.tick };
                state.lane ??= Math.max(16, Math.min(176, Math.round(bot.x / 8) * 8));
                this.breachProgress.set(bot.id, state);
                const midfield = 96;
                if (bot.team === 1 ? bot.y > midfield + 8 : bot.y < midfield - 8) {
                    this.tasks.set(bot.id, { kind: 'guard', target: { x: state.lane, y: midfield } });
                } else this.tasks.set(bot.id, { ...task, maxShotDistance: 64, preferredRange: 24 });
            }
        }
    }

    update(bot) {
        const options = this.constructor.navigationOptions;
        let state = this.breachProgress.get(bot.id);
        if (!state) {
            state = { anchor: { x: bot.x, y: bot.y }, anchorTick: this.tick, commitUntil: 0 };
            this.breachProgress.set(bot.id, state);
        }
        if (distance(bot, state.anchor) > 12) {
            state.anchor = { x: bot.x, y: bot.y };
            state.anchorTick = this.tick;
        }
        const task = this.tasks.get(bot.id);
        if (options.stallCommit && task && ['attack', 'fight'].includes(task.kind)) {
            if (this.tick - state.anchorTick >= 180 && this.tick >= (state.commitUntil || 0)) {
                state.commitUntil = this.tick + 300;
                this.memory.get(bot.id)?.path.splice(0);
                const route = this.memory.get(bot.id);
                if (route) route.planTick = -100;
            }
            if (this.tick < (state.commitUntil || 0)) {
                this.tasks.set(bot.id, { ...task, maxShotDistance: 32, preferredRange: 16 });
            }
        }
        if (options.cornerRecovery) {
            const recovery = state.recovery;
            if (recovery && (this.tick >= recovery.expires || !(this.room.map[recovery.r]?.[recovery.c]?.mask & (1 << recovery.bit)))) {
                state.recovery = null;
                const route = this.memory.get(bot.id);
                if (route) route.planTick = -100;
            }
            if (!state.recovery && this.tick - state.anchorTick >= 120 && this.tick - (state.lastFire ?? state.anchorTick) >= 90) {
                const waypoint = this.memory.get(bot.id)?.path[0];
                const found = waypoint && findBreachPosition(this.room, bot, waypoint);
                if (found) state.recovery = { ...found, expires: this.tick + 240 };
            }
            if (state.recovery) {
                const recovery = state.recovery;
                while (recovery.path.length && distance(bot, recovery.path[0]) < .05) recovery.path.shift();
                const next = recovery.path[0];
                if (next && Math.abs(next.x - bot.x) > .05 && Math.abs(next.y - bot.y) > .05) state.recovery = null;
                else {
                    this.tasks.set(bot.id, { kind: 'guard', target: recovery.firePosition });
                    const route = this.memory.get(bot.id);
                    if (route) {
                        route.path = recovery.path.map(p => ({ ...p }));
                        route.planTick = this.tick;
                        route.taskKey = `guard:${Math.round(recovery.firePosition.x / 16)}:${Math.round(recovery.firePosition.y / 16)}:::`;
                        route.escapeUntil = 0;
                        route.alignUntil = 0;
                    }
                }
            }
        }
        const cooldown = bot.bulletTimer;
        super.update(bot);
        if (bot.bulletTimer > cooldown) state.lastFire = this.tick;
        if (state.recovery && task) this.tasks.set(bot.id, task);
    }
    };
}

export class NavigationV4 extends withNavigationV4(TacticalV3) {}

function clearSegment(room, bot, a, b) {
    const length = distance(a, b), samples = Math.max(1, Math.ceil(length));
    for (let i = 1; i <= samples; i++) {
        const p = { x: a.x + (b.x - a.x) * i / samples, y: a.y + (b.y - a.y) * i / samples };
        if (p.x < 0 || p.y < 0 || p.x > 192 || p.y > 192 || !canMoveTo(p.x, p.y, room.map)
            || room.checkGlobalCollision(p.x, p.y, bot.x, bot.y, bot.id)) return false;
    }
    return true;
}

// A cleared central shell lane can leave a micro-block under the hull's outer
// corner. Find a reachable nearby muzzle position that actually touches cover,
// retreating first when the tank has no room to sidestep at the corner.
export function findBreachPosition(room, bot, waypoint) {
    const candidates = [];
    if (Math.abs(waypoint.x - bot.x) > .05) candidates.push(waypoint.x > bot.x ? 'RIGHT' : 'LEFT');
    if (Math.abs(waypoint.y - bot.y) > .05) candidates.push(waypoint.y > bot.y ? 'DOWN' : 'UP');
    let best = null;
    for (const direction of candidates) {
        const [dx, dy] = DIRECTIONS[direction];
        const hull = { x: bot.x + dx * 4 + 1, y: bot.y + dy * 4 + 1, width: 14, height: 14 };
        for (let r = Math.floor(hull.y / 8); r <= Math.floor((hull.y + 14) / 8); r++) for (let c = Math.floor(hull.x / 8); c <= Math.floor((hull.x + 14) / 8); c++) {
            const cell = room.map[r]?.[c];
            if (!cell || ![1, 2].includes(cell.type) || (cell.type === 2 && bot.level < 4) || room.teamManager.isInBaseZone(bot.team, r, c)) continue;
            for (let bit = 0; bit < 4; bit++) {
                const block = { x: c * 8 + bit % 2 * 4, y: r * 8 + Math.floor(bit / 2) * 4, width: 4, height: 4 };
                if (!(cell.mask & (1 << bit)) || !checkRectOverlap(hull, block)) continue;
                for (const retreat of [0, 4, 8, 12]) {
                    const back = { x: bot.x - dx * retreat, y: bot.y - dy * retreat };
                    if (!clearSegment(room, bot, bot, back)) continue;
                    for (let shift = -8; shift <= 8; shift++) {
                        const p = { x: back.x + dy * shift, y: back.y + dx * shift };
                        if (!clearSegment(room, bot, back, p)) continue;
                        const bullet = createBullet({ ...bot, ...p, direction }, bot.bulletSpeed);
                        const wall = firstWall(room, bullet, 36);
                        if (!wall || wall.r !== r || wall.c !== c) continue;
                        const shot = shotAt(room, { ...bot, ...p }, direction,
                            { x: p.x + dx * 48, y: p.y + dy * 48, width: 16, height: 16 });
                        if (!shot?.breach) continue;
                        const score = retreat + Math.abs(shift) + wall.distance / 8;
                        if (!best || score < best.score) best = { direction, firePosition: p, path: [back, p].filter((v, i, points) => distance(i ? points[i - 1] : bot, v) > .05), r, c, bit, score };
                    }
                }
            }
        }
    }
    return best;
}

export class NavigationClose extends NavigationV4 {
    static navigationOptions = Object.freeze({ closeRange: 64 });
}
export class NavigationLane extends NavigationV4 {
    static navigationOptions = Object.freeze({ pushLane: true });
}

export class NavigationBreach extends NavigationV4 {
    static navigationOptions = Object.freeze({ cornerRecovery: true });
}
export class NavigationCombined extends NavigationV4 {
    static navigationOptions = Object.freeze({ stallCommit: true, cornerRecovery: true });
}
