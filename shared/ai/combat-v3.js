import { TacticalV2 } from './tactical-v2.js';
import { MAP_WIDTH, MAP_HEIGHT, TANK_STATS } from '../config.js';
import { updateTankMovement } from '../tank.js';
import { createBullet } from '../bullet.js';
import { checkRectOverlap } from '../utils.js';
import { DIRECTIONS, distance, liveTanks, shotAt, wallAt } from './geometry.js';

const directions = Object.keys(DIRECTIONS);
const HORIZON = 28;
const COMMIT = 6;

function physicalTank(tank) {
    // Copy only public physical fields, so forecasts never inspect an input packet.
    const copy = {};
    for (const key of ['id', 'team', 'x', 'y', 'width', 'height', 'direction', 'speed',
        'hp', 'level', 'bulletSpeed', 'shieldTimer', 'isMoving', 'lastDirection', 'slideTimer']) copy[key] = tank[key];
    return copy;
}

// Match the engine's substeps and endpoint tank/bullet collision checks. In particular,
// a shell behind cover must not create a fictitious dodge or interception opportunity.
function traceProjectile(room, source, ticks) {
    const bullet = { ...source }, trace = [null];
    const [dx, dy] = DIRECTIONS[bullet.direction];
    const steps = Math.ceil(bullet.speed / 2);
    for (let tick = 1; tick <= ticks; tick++) {
        for (let step = 0; step < steps; step++) {
            if (wallAt(room.map, bullet)) return trace;
            bullet.x += dx * bullet.speed / steps;
            bullet.y += dy * bullet.speed / steps;
            if (bullet.x < 0 || bullet.y < 0 || bullet.x > MAP_WIDTH || bullet.y > MAP_HEIGHT) return trace;
        }
        trace.push({ x: bullet.x, y: bullet.y, width: 4, height: 4 });
    }
    return trace;
}

function weaponSpeed(tank) {
    return tank.bulletSpeed || TANK_STATS.player.levels[tank.level || 1].bulletSpeed;
}

export class TacticalCombat extends TacticalV2 {
    reset() {
        super.reset();
        this.motion = new Map();
    }

    prepare() {
        super.prepare();
        const units = liveTanks(this.room), living = new Set(units.map(t => t.id));
        for (const id of this.motion.keys()) if (!living.has(id)) this.motion.delete(id);
        for (const tank of units) {
            const previous = this.motion.get(tank.id);
            const turned = previous && previous.direction !== tank.direction;
            this.motion.set(tank.id, {
                direction: tank.direction,
                stable: previous && !turned ? previous.stable + 1 : 1,
                // A small prior prevents treating an unobserved target as perfectly predictable.
                turnRate: previous ? previous.turnRate * .96 + (turned ? .04 : 0) : .025
            });
        }
    }

    movePreview(tank, direction) {
        updateTankMovement(tank, direction, MAP_WIDTH, MAP_HEIGHT, this.room.map,
            this.room.checkGlobalCollision.bind(this.room));
    }

    chooseShot(bot, task, waypoint) {
        const room = this.room;
        const shots = directions.map(direction => {
            const bullet = createBullet({ ...physicalTank(bot), direction }, bot.bulletSpeed);
            return { direction, trace: traceProjectile(room, bullet, 80), score: 0 };
        });
        const home = room.teamManager.getAllBases().find(b => b.team === bot.team && !b.isDead);
        const opponents = liveTanks(room).filter(t => t.team !== bot.team);
        let best = null;
        const consider = (shot, score) => {
            if (shot && score > 0 && (!best || score > best.score)) best = { ...shot, score };
        };
        for (const target of opponents) {
            const motion = this.motion.get(target.id);
            const hazard = Math.max(.012, Math.min(.09, motion?.turnRate ?? .025));
            // Continue and several plausible stopping times form a small uncertainty model.
            // It only uses observed movement; no input packets or control-type priority.
            const models = target.isMoving
                ? [{ stop: Infinity, weight: .55 }, { stop: 6, weight: .2 },
                    { stop: 12, weight: .15 }, { stop: 24, weight: .1 }]
                : [{ stop: 0, weight: 1 }];
            const scoreByDirection = new Map(directions.map(d => [d, 0]));
            for (const model of models) {
                const preview = physicalTank(target), hit = new Set();
                for (let tick = 1; tick <= 80; tick++) {
                    if (target.isMoving && tick <= model.stop) this.movePreview(preview, target.direction);
                    if ((target.shieldTimer || 0) >= tick) continue;
                    for (const shot of shots) {
                        if (hit.has(shot.direction) || !shot.trace[tick]
                            || !checkRectOverlap(shot.trace[tick], preview)) continue;
                        const solution = shotAt(room, bot, shot.direction, preview);
                        if (!solution || solution.breach) continue;
                        hit.add(shot.direction);
                        // Long exact leads become less credible as observed turns become frequent.
                        // Moving along the firing axis does not require a thin lateral prediction.
                        const [mx, my] = DIRECTIONS[target.direction];
                        const [sx, sy] = DIRECTIONS[shot.direction];
                        const lateral = target.isMoving && Math.abs(mx * sy - my * sx) > 0;
                        const confidence = lateral ? Math.exp(-hazard * Math.max(0, tick - 6)) : 1;
                        const value = 120 + (home && distance(target, home) < 88 ? 40 : 0)
                            + (target.hp <= 1 ? 8 : 0) - tick * .35;
                        scoreByDirection.set(shot.direction, scoreByDirection.get(shot.direction)
                            + model.weight * confidence * value);
                    }
                    if (hit.size === shots.length) break;
                }
            }
            for (const shot of shots) consider({ direction: shot.direction, breach: false }, scoreByDirection.get(shot.direction));
        }
        for (const base of room.teamManager.getAllBases()) {
            if (base.team === bot.team || base.isDead) continue;
            for (const direction of directions) {
                const shot = shotAt(room, bot, direction, base);
                if (shot) consider(shot, (shot.breach ? 65 : 155) - shot.distance / 6);
            }
        }
        if (waypoint) {
            for (const direction of directions) {
                const shot = shotAt(room, bot, direction, { ...waypoint, width: 16, height: 16 });
                if (shot?.breach) consider(shot, 40 - shot.distance / 8);
            }
        }
        for (const target of opponents) {
            for (const direction of directions) {
                const shot = shotAt(room, bot, direction, target);
                if (shot?.breach) consider(shot, 35 - shot.distance / 8);
            }
        }
        for (const bullet of room.bullets) {
            if (bullet.isDead || bullet.team === bot.team || distance(bot, bullet) > 112) continue;
            const incoming = traceProjectile(room, bullet, HORIZON);
            const dangerTick = incoming.findIndex(rect => rect && checkRectOverlap(bot, rect));
            if (dangerTick < 1 || bot.shieldTimer >= dangerTick) continue;
            for (const shot of shots) {
                for (let tick = 1; tick <= dangerTick; tick++) {
                    if (!incoming[tick] || !shot.trace[tick] || !checkRectOverlap(incoming[tick], shot.trace[tick])) continue;
                    // Preserve the own-base safety guard used by ordinary shots.
                    const safe = shotAt(room, bot, shot.direction, incoming[tick]);
                    if (safe && !safe.breach) consider({ ...safe, intercept: true },
                        145 + (HORIZON - dangerTick) * 2 - tick);
                    break;
                }
            }
        }
        return best;
    }

    incoming(bot) {
        const room = this.room;
        const bullets = room.bullets.filter(b => !b.isDead && b.team !== bot.team && distance(bot, b) < 160)
            .map(b => ({ ...b, trace: traceProjectile(room, b, HORIZON), predicted: false, delay: 0 }));
        for (const target of liveTanks(room)) {
            if (target.team === bot.team || distance(bot, target) > 128) continue;
            const cooldown = Math.max(0, target.bulletTimer ?? target.bulletCooldown ?? 0);
            if (cooldown > 10) continue;
            const preview = physicalTank(target);
            // Predict only the already visible heading, including collisions with cover.
            for (let tick = 0; tick < cooldown; tick++) {
                if (target.isMoving) this.movePreview(preview, target.direction);
            }
            const bullet = createBullet(preview, weaponSpeed(target));
            const trace = traceProjectile(room, bullet, HORIZON - cooldown);
            bullets.push({ ...bullet, predicted: true, delay: cooldown + 1,
                trace: Array(cooldown + 1).fill(null).concat(trace.slice(1)) });
        }
        return bullets;
    }

    trajectoryRisk(preview, direction, bullets, from, to) {
        let risk = 0;
        for (let tick = from; tick <= to; tick++) {
            this.movePreview(preview, direction);
            if ((preview.shieldTimer || 0) >= tick) continue;
            for (const bullet of bullets) {
                if (!bullet.trace[tick] || !checkRectOverlap(preview, bullet.trace[tick])) continue;
                const value = bullet.predicted ? 42 + (HORIZON - tick) : 400 + (HORIZON + 1 - tick) * 10;
                risk = Math.max(risk, value);
            }
        }
        return risk;
    }

    movementRisk(bot, direction, bullets) {
        if (bot.shieldTimer > HORIZON || !bullets.length) return 0;
        // Permit a short action when a physically reachable later turn can escape.
        // The controller reevaluates after every real tick, so this does not commit
        // the tank to an imagined 28-tick straight line.
        const prefix = physicalTank(bot);
        const immediate = this.trajectoryRisk(prefix, direction, bullets, 1, COMMIT);
        if (immediate >= 400) return immediate;
        let future = this.trajectoryRisk({ ...prefix }, direction, bullets, COMMIT + 1, HORIZON);
        if (!future) return immediate;
        for (const escape of [null, ...directions]) {
            if (escape === direction) continue;
            future = Math.min(future, this.trajectoryRisk({ ...prefix }, escape, bullets, COMMIT + 1, HORIZON));
            if (!future) break;
        }
        return Math.max(immediate, future);
    }

    combatMovementCost(bot, direction, { task } = {}) {
        // Preserve strategic base/bonus routes. In a nearby duel, a lateral step
        // breaks the opponent's firing axis while a short approach reduces leading error.
        if (task && !['fight', 'defend'].includes(task.kind)) return 0;
        let cost = 0;
        const preview = physicalTank(bot);
        for (let tick = 0; tick < COMMIT; tick++) this.movePreview(preview, direction);
        for (const target of liveTanks(this.room)) {
            if (target.team === bot.team || distance(bot, target) > 96 || target.shieldTimer > 20) continue;
            const oldDistance = distance(bot, target), nextDistance = distance(preview, target);
            const range = weaponSpeed(target) >= bot.bulletSpeed && bot.hp <= 1 ? 40 : 28;
            cost += (Math.abs(nextDistance - range) - Math.abs(oldDistance - range)) * .35;
            const ready = Math.max(0, target.bulletTimer ?? target.bulletCooldown ?? 0) <= 10;
            const lane = ready && shotAt(this.room, { ...physicalTank(target), bulletSpeed: weaponSpeed(target) }, target.direction, preview);
            if (lane && !lane.breach) cost += 8;
        }
        return cost;
    }
}
