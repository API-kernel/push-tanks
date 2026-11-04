import { MAP_WIDTH, MAP_HEIGHT } from '../config.js';
import { updateTankMovement } from '../tank.js';
import { createBullet } from '../bullet.js';
import { checkRectOverlap } from '../utils.js';
import { canMoveTo } from '../physics.js';
import { DIRECTIONS, distance, firstWall, liveTanks, shotAt } from './geometry.js';
import { findPath } from './navigation.js';

// Versioned, deterministic policy. All private planning state stays out of network snapshots.
export class TacticalAI {
    constructor(room) {
        this.room = room;
        this.reset();
    }

    reset() {
        this.tick = 0;
        this.tasks = new Map();
        this.memory = new Map();
    }

    prepare() {
        this.tick++;
        const living = new Set(this.room.enemies.map(b => b.id));
        for (const id of this.memory.keys()) if (!living.has(id)) this.memory.delete(id);
        if (this.tick % 20 === 1 || this.room.enemies.some(b => !this.tasks.has(b.id))) this.assignTasks();
    }

    assignTasks() {
        const room = this.room;
        const units = liveTanks(room);
        const bases = room.teamManager.getAllBases().filter(b => !b.isDead);
        this.tasks.clear();
        for (const team of [1, 2]) {
            const bots = room.enemies.filter(b => b.team === team);
            const opponents = units.filter(t => t.team !== team);
            const home = bases.find(b => b.team === team);
            const enemyBase = bases.find(b => b.team !== team);
            const threats = home ? opponents.filter(t => distance(t, home) < 88)
                .sort((a, b) => distance(a, home) - distance(b, home)) : [];
            const available = new Set(bots);
            const assignNearest = (target, kind, candidates = [...available]) => {
                const bot = candidates.sort((a, b) => distance(a, target) - distance(b, target) || a.id - b.id)[0];
                if (!bot) return;
                this.tasks.set(bot.id, { kind, target: { ...target } });
                available.delete(bot);
            };
            // Reinforce a threatened base; keep an attacker when there are several bots.
            const defenders = Math.min(threats.length, Math.max(1, bots.length - 1));
            for (let i = 0; i < defenders; i++) assignNearest(threats[i], 'defend');
            if (home && !threats.length && bots.length >= 3) {
                assignNearest({ x: home.x - 16, y: team === 1 ? 144 : 48 }, 'guard');
            }
            // One collector, not the entire team. Do not abandon an immediate base threat.
            const bonus = room.activeBonus;
            if (bonus && !threats.some(t => distance(t, home) < 40)) {
                const candidates = [...available].filter(b => distance(b, bonus) < 128
                    && !((bonus.type === 'star' || bonus.type === 'gun') && b.level >= 4));
                assignNearest(bonus, 'bonus', candidates);
            }
            for (const bot of available) {
                const near = opponents.slice().sort((a, b) => distance(bot, a) - distance(bot, b))[0];
                const target = near && (!enemyBase || distance(bot, near) < 56) ? near : enemyBase;
                if (target) this.tasks.set(bot.id, { kind: target === enemyBase ? 'attack' : 'fight', target: { ...target } });
            }
        }
    }

    getTask(id) { return this.tasks.get(id); }

    chooseShot(bot, task, waypoint) {
        const room = this.room;
        let best = null;
        const home = room.teamManager.getAllBases().find(b => b.team === bot.team && !b.isDead);
        const consider = (target, value) => {
            for (const direction of Object.keys(DIRECTIONS)) {
                const shot = shotAt(room, bot, direction, target);
                if (!shot) continue;
                const score = value - shot.distance / 8 - (shot.breach ? 30 : 0);
                if (!best || score > best.score) best = { ...shot, score };
            }
        };
        for (const target of liveTanks(room)) {
            if (target.team === bot.team || target.shieldTimer > 0) continue;
            const threat = home && distance(target, home) < 80;
            const value = 65 + (threat ? 35 : 0);
            // Lead a moving tank using its visible direction/speed, never its future inputs.
            const travel = Math.min(24, distance(bot, target) / bot.bulletSpeed);
            const [dx, dy] = DIRECTIONS[target.direction] || [0, 0];
            const predicted = target.isMoving ? { ...target,
                x: Math.max(0, Math.min(192, target.x + dx * target.speed * travel)),
                y: Math.max(0, Math.min(192, target.y + dy * target.speed * travel)) } : target;
            consider(predicted, value);
            if (distance(bot, target) < 32 || !target.isMoving) consider(target, value);
        }
        for (const base of room.teamManager.getAllBases()) {
            if (base.team !== bot.team && !base.isDead) consider(base, 100);
        }
        if (waypoint && !canMoveTo(waypoint.x, waypoint.y, room.map)) consider({ ...waypoint, width: 16, height: 16 }, 42);
        // Incoming shells can be intercepted, particularly on the approach to our base.
        for (const b of room.bullets) {
            if (!b.isDead && b.team !== bot.team && distance(bot, b) < 56) consider(b, 55);
        }
        return best && best.score > 0 ? best : null;
    }

    incoming(bot) {
        const room = this.room;
        return room.bullets.filter(b => !b.isDead && b.team !== bot.team && distance(bot, b) < 144)
            .map(b => ({ ...b, reach: firstWall(room, b, b.speed * 28)?.distance ?? Infinity }));
    }

    movementRisk(bot, direction, bullets) {
        if (bot.shieldTimer > 28 || !bullets.length) return 0;
        const preview = { ...bot };
        let risk = 0;
        for (let tick = 1; tick <= 28; tick++) {
            updateTankMovement(preview, direction, MAP_WIDTH, MAP_HEIGHT, this.room.map,
                this.room.checkGlobalCollision.bind(this.room));
            for (const b of bullets) {
                const d = b.speed * tick;
                if (d >= b.reach) continue;
                const [dx, dy] = DIRECTIONS[b.direction];
                // Sweep over the preceding tick to avoid tunnelling past fast shells.
                const swept = { x: b.x + dx * d - (dx > 0 ? b.speed : 0),
                    y: b.y + dy * d - (dy > 0 ? b.speed : 0),
                    width: 4 + Math.abs(dx * b.speed), height: 4 + Math.abs(dy * b.speed) };
                if (checkRectOverlap(preview, swept)) risk = Math.max(risk, 400 + (29 - tick) * 10);
            }
        }
        return risk;
    }

    update(bot) {
        const room = this.room;
        const task = this.tasks.get(bot.id);
        let state = this.memory.get(bot.id);
        if (!state) {
            state = { path: [], planTick: -100, stuck: 0 };
            this.memory.set(bot.id, state);
        }
        const taskKey = task ? `${task.kind}:${Math.round(task.target.x / 16)}:${Math.round(task.target.y / 16)}` : '';
        if (taskKey !== state.taskKey || this.tick - state.planTick >= 30 || state.stuck >= 10) {
            state.path = findPath(room, bot, task);
            // An inaccessible base must not leave the team idle behind a barrier.
            // Engage a reachable opponent instead; both control types are candidates.
            if (!state.path.length && task?.kind === 'attack') {
                const opponents = liveTanks(room).filter(t => t.team !== bot.team)
                    .sort((a, b) => distance(bot, a) - distance(bot, b));
                for (const target of opponents.slice(0, 3)) {
                    state.path = findPath(room, bot, { kind: 'fight', target });
                    if (state.path.length) break;
                }
            }
            state.taskKey = taskKey;
            state.planTick = this.tick;
            state.stuck = 0;
        }
        while (state.path.length && distance(bot, state.path[0]) < .05) state.path.shift();
        const waypoint = state.path[0];
        let desired = null;
        if (waypoint) {
            const dx = waypoint.x - bot.x, dy = waypoint.y - bot.y;
            desired = Math.abs(dx) > .05 ? (dx > 0 ? 'RIGHT' : 'LEFT') : (dy > 0 ? 'DOWN' : 'UP');
        }
        let direction = desired;
        const bullets = this.incoming(bot);
        const currentRisk = this.movementRisk(bot, desired, bullets);
        if (currentRisk > 0) {
            let best = Infinity;
            for (const candidate of [null, ...Object.keys(DIRECTIONS)]) {
                const [dx, dy] = DIRECTIONS[candidate] || [0, 0];
                const cost = this.movementRisk(bot, candidate, bullets) + (candidate === desired ? 0 : 5)
                    + (waypoint ? distance({ x: bot.x + dx * 8, y: bot.y + dy * 8 }, waypoint) / 8 : 0);
                if (cost < best) { best = cost; direction = candidate; }
            }
        }
        const shot = bot.bulletTimer <= 0 ? this.chooseShot(bot, task, waypoint) : null;
        // Turning the turret turns the tank. Do not move one way while shooting another.
        if (shot && currentRisk === 0 && shot.direction !== direction) direction = null;
        const oldX = bot.x, oldY = bot.y, speed = bot.speed;
        if (direction === desired && waypoint) {
            const remaining = direction === 'LEFT' || direction === 'RIGHT' ? Math.abs(waypoint.x - bot.x) : Math.abs(waypoint.y - bot.y);
            bot.speed = Math.min(speed, remaining);
        }
        updateTankMovement(bot, direction, MAP_WIDTH, MAP_HEIGHT, room.map, room.checkGlobalCollision.bind(room));
        bot.speed = speed;
        if (desired && oldX === bot.x && oldY === bot.y) state.stuck++;
        else state.stuck = 0;
        if (shot && (currentRisk === 0 || bot.direction === shot.direction)) {
            bot.direction = shot.direction;
            room.bullets.push(createBullet(bot, bot.bulletSpeed));
            room.bulletEvents.push({ type: 'ENEMY_FIRE', ownerId: bot.id, team: bot.team });
            bot.bulletTimer = bot.bulletCooldownMax;
        }
    }
}
