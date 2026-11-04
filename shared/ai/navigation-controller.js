import { TacticalV2 } from './tactical-v2.js';
import { MAP_WIDTH, MAP_HEIGHT } from '../config.js';
import { updateTankMovement } from '../tank.js';
import { createBullet } from '../bullet.js';
import { DIRECTIONS, distance, liveTanks } from './geometry.js';
import { findPath } from './navigation-v2.js';

const directionTo = (bot, point) => Math.abs(point.x - bot.x) > .05
    ? (point.x > bot.x ? 'RIGHT' : 'LEFT') : Math.abs(point.y - bot.y) > .05 ? (point.y > bot.y ? 'DOWN' : 'UP') : null;

// Navigation is independent of combat selection: subclasses can override the
// inherited combat methods and combatMovementCost without copying steering.
export class TacticalNavigation extends TacticalV2 {
    previewMovement(bot, direction, ticks = 1) {
        const preview = { ...bot };
        for (let tick = 0; tick < ticks; tick++) updateTankMovement(preview, direction, MAP_WIDTH, MAP_HEIGHT,
            this.room.map, this.room.checkGlobalCollision.bind(this.room));
        return preview;
    }

    combatMovementCost() { return 0; }

    update(bot) {
        const room = this.room, task = this.tasks.get(bot.id);
        let state = this.memory.get(bot.id);
        if (!state) {
            state = { path: [], planTick: -100, stuck: 0, escapeUntil: 0 };
            this.memory.set(bot.id, state);
        }
        const taskKey = task ? `${task.kind}:${Math.round(task.target.x / 16)}:${Math.round(task.target.y / 16)}:${task.maxShotDistance || ''}:${task.approach?.x || ''}:${task.approach?.y || ''}` : '';
        if (this.tick >= (state.alignUntil || 0) && (taskKey !== state.taskKey || this.tick - state.planTick >= 45 || state.stuck >= 10)) {
            state.routeTask = task;
            state.path = findPath(room, bot, task, { avoid: state.blocked ? [state.blocked] : [] });
            if (!state.path.length && task?.kind === 'attack') {
                const opponents = liveTanks(room).filter(tank => tank.team !== bot.team)
                    .sort((a, b) => distance(bot, a) - distance(bot, b));
                for (const target of opponents.slice(0, 3)) {
                    const alternative = { kind: 'fight', target };
                    state.path = findPath(room, bot, alternative);
                    if (state.path.length) { state.routeTask = alternative; break; }
                }
            }
            state.taskKey = taskKey;
            state.planTick = this.tick;
            state.stuck = 0;
        }
        while (state.path.length && distance(bot, state.path[0]) < .05) state.path.shift();
        let waypoint = state.path[0];
        // If an avoidance move left the path, return by a tested connector on
        // the next plan instead of taking an unchecked diagonal to an old node.
        if (waypoint && Math.abs(bot.x - waypoint.x) > .05 && Math.abs(bot.y - waypoint.y) > .05 && this.tick >= state.escapeUntil && this.tick >= (state.alignUntil || 0)) {
            state.path = findPath(room, bot, state.routeTask || task, { avoid: state.blocked ? [state.blocked] : [] });
            state.planTick = this.tick;
            waypoint = state.path[0];
        }
        const aligning = this.tick < (state.alignUntil || 0);
        const desired = aligning ? state.alignDirection : waypoint ? directionTo(bot, waypoint) : null;
        const bullets = this.incoming(bot);
        let shot = bot.bulletTimer <= 0 ? this.chooseShot(bot, task, waypoint) : null;
        const context = { task, waypoint, desired, bullets, shot };
        let direction = desired;
        const desiredRisk = this.movementRisk(bot, desired, bullets);
        const desiredCombatCost = this.combatMovementCost(bot, desired, context);
        if (desiredRisk > 0 || desiredCombatCost > 0) {
            let best = Infinity;
            for (const candidate of [desired, null, ...Object.keys(DIRECTIONS)]) {
                const preview = this.previewMovement(bot, candidate, 4);
                const progress = waypoint ? (distance(preview, waypoint) - distance(bot, waypoint)) / 4 : 0;
                const blocked = candidate && distance(bot, preview) < .05 ? 4 : 0;
                const cost = this.movementRisk(bot, candidate, bullets) + this.combatMovementCost(bot, candidate, context)
                    + (candidate === desired ? 0 : 3) + progress + blocked;
                if (cost < best) { best = cost; direction = candidate; }
            }
        }
        // Allies can occupy the same narrow route indefinitely. After waiting,
        // the later unit yields by moving to real free space. The earlier unit
        // also escapes after repeated obstruction, so stationary allies cannot
        // lock an entire spawn lane.
        if (this.tick < state.escapeUntil) direction = state.escapeDirection;
        else if (state.stuck >= 5 && desired) {
            const ally = liveTanks(room).find(tank => tank.id !== bot.id && tank.team === bot.team && distance(tank, bot) < 36);
            const desiredPreview = this.previewMovement(bot, desired);
            if (ally && distance(bot, desiredPreview) < .05 && (String(bot.id) > String(ally.id) || state.stuck >= 9)) {
                let best = -Infinity, escape = null;
                for (const candidate of Object.keys(DIRECTIONS)) {
                    if (candidate === desired) continue;
                    const preview = this.previewMovement(bot, candidate, 12);
                    const moved = distance(bot, preview);
                    if (moved < 4 || this.movementRisk(bot, candidate, bullets) > 0) continue;
                    const perpendicular = DIRECTIONS[candidate][0] !== DIRECTIONS[desired][0] && DIRECTIONS[candidate][1] !== DIRECTIONS[desired][1];
                    const score = moved + distance(preview, ally) / 2 + (perpendicular ? 6 : 0) - this.combatMovementCost(bot, candidate, context);
                    if (score > best) { best = score; escape = candidate; }
                }
                if (escape) {
                    direction = state.escapeDirection = escape;
                    state.escapeUntil = this.tick + Math.ceil(16 / bot.speed);
                    state.blocked = { x: ally.x, y: ally.y };
                    state.planTick = -100;
                }
            }
        }
        const currentRisk = this.movementRisk(bot, direction, bullets);
        if (shot && currentRisk === 0 && shot.direction !== direction) {
            if (this.movementRisk(bot, null, bullets) === 0 || shot.intercept) direction = null;
            else shot = null;
        }
        const oldX = bot.x, oldY = bot.y, speed = bot.speed;
        if (direction === desired && waypoint && !aligning) {
            const remaining = direction === 'LEFT' || direction === 'RIGHT' ? Math.abs(waypoint.x - bot.x) : Math.abs(waypoint.y - bot.y);
            bot.speed = Math.min(speed, remaining);
        }
        updateTankMovement(bot, direction, MAP_WIDTH, MAP_HEIGHT, room.map, room.checkGlobalCollision.bind(room));
        bot.speed = speed;
        if (direction && this.tick >= state.escapeUntil) {
            const [dx, dy] = DIRECTIONS[direction];
            const forward = Math.abs((bot.x - oldX) * dx + (bot.y - oldY) * dy);
            const lateral = Math.abs((bot.x - oldX) * dy + (bot.y - oldY) * dx);
            if (forward < .01 && lateral > .01) {
                // Physics may slide sideways to enter a narrow opening. Keep
                // that steering briefly; snapping back to the old waypoint
                // would undo the assist every other tick forever.
                state.alignDirection = direction;
                state.alignUntil = this.tick + 6;
                state.planTick = -100;
            }
        }
        if (direction && oldX === bot.x && oldY === bot.y) state.stuck++;
        else if (distance({ x: oldX, y: oldY }, bot) > .01) state.stuck = 0;
        if (shot && (currentRisk === 0 || bot.direction === shot.direction || (shot.intercept && !direction))) {
            bot.direction = shot.direction;
            room.bullets.push(createBullet(bot, bot.bulletSpeed));
            room.bulletEvents.push({ type: 'ENEMY_FIRE', ownerId: bot.id, team: bot.team });
            bot.bulletTimer = bot.bulletCooldownMax;
        }
    }
}
