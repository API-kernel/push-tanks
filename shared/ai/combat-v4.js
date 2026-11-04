import { TacticalV3 } from './tactical-v3.js';
import { MAP_WIDTH, MAP_HEIGHT, TANK_STATS } from '../config.js';
import { createBullet } from '../bullet.js';
import { updateTankMovement } from '../tank.js';
import { checkRectOverlap } from '../utils.js';
import { DIRECTIONS, distance, liveTanks, shotAt, wallAt } from './geometry.js';

const directions = Object.keys(DIRECTIONS);
const opposite = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
const HORIZON = 28;
const physical = tank => ({ id: tank.id, team: tank.team, x: tank.x, y: tank.y,
    width: tank.width || 16, height: tank.height || 16, direction: tank.direction,
    speed: tank.speed, hp: tank.hp, level: tank.level || 1, isMoving: tank.isMoving,
    shieldTimer: tank.shieldTimer || 0, slideTimer: tank.slideTimer, lastDirection: tank.lastDirection,
    bulletSpeed: tank.bulletSpeed ?? TANK_STATS.player.levels[tank.level || 1].bulletSpeed });
const cooldown = tank => Math.max(0, tank.bulletTimer ?? tank.bulletCooldown ?? 0);
const median = values => values.length ? values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0;

function trace(room, source, ticks) {
    const bullet = { ...source }, positions = [null], [dx, dy] = DIRECTIONS[bullet.direction];
    const steps = Math.ceil(bullet.speed / 2);
    const bases = room.teamManager.getAllBases().filter(base => !base.isDead);
    for (let tick = 1; tick <= ticks; tick++) {
        for (let step = 0; step < steps; step++) {
            if (wallAt(room.map, bullet)) return positions;
            bullet.x += dx * bullet.speed / steps;
            bullet.y += dy * bullet.speed / steps;
            if (bullet.x < 0 || bullet.y < 0 || bullet.x > MAP_WIDTH || bullet.y > MAP_HEIGHT) return positions;
        }
        // Bases consume a projectile even when its owner cannot damage that base.
        const base = bases.find(base => checkRectOverlap(base, bullet));
        if (base) {
            positions.baseHit = { tick, base, rect: { x: bullet.x, y: bullet.y, width: 4, height: 4 } };
            return positions;
        }
        positions.push({ x: bullet.x, y: bullet.y, width: 4, height: 4 });
    }
    return positions;
}

// Integrated v3 navigation/coordination with an isolated experimental combat policy.
// No input packet, nickname or control-type target priority participates in decisions.
export class TacticalCombatV4 extends TacticalV3 {
    reset() {
        super.reset();
        this.runs = new Map();
    }

    prepare() {
        super.prepare();
        this.observeCombatMotion();
    }

    observeCombatMotion() {
        const units = liveTanks(this.room), living = new Set(units.map(tank => tank.id));
        for (const id of this.runs.keys()) if (!living.has(id)) this.runs.delete(id);
        for (const tank of units) {
            const previous = this.runs.get(tank.id);
            const changed = previous && tank.direction !== previous.direction;
            const moving = tank.isMoving && !this.frozenFor(tank);
            const periods = previous?.periods.slice() || [];
            if (previous?.moving && !moving) periods.length = 0;
            if (changed && previous.moving && moving && previous.age >= 4 && previous.age <= 120) {
                periods.push({ ticks: previous.age, reversal: opposite[previous.direction] === tank.direction });
                if (periods.length > 6) periods.shift();
            }
            this.runs.set(tank.id, { direction: tank.direction, moving,
                age: previous && !changed && previous.moving === moving ? previous.age + 1 : 1,
                turnRate: previous ? (previous.turnRate ?? .025) * .96 + (changed ? .04 : 0) : .025,
                periods });
        }
    }

    movePreview(tank, direction) {
        updateTankMovement(tank, direction, MAP_WIDTH, MAP_HEIGHT, this.room.map,
            this.room.checkGlobalCollision.bind(this.room));
    }

    frozenFor(tank) {
        return this.room.effectTimers.clockTeam !== tank.team && tank.bulletTimer !== undefined
            ? Math.max(0, this.room.effectTimers.clock) : 0;
    }

    motionModels(target) {
        if (!target.isMoving) return [{ stop: 0, weight: 1 }];
        const run = this.runs.get(target.id);
        const reversals = run?.periods.filter(period => period.reversal).map(period => period.ticks) || [];
        const period = median(reversals);
        const deviation = median(reversals.map(value => Math.abs(value - period)));
        const predictable = reversals.length >= 2 && run.age <= period * 1.3
            ? Math.max(0, 1 - deviation / period * 3) * Math.min(1, reversals.length / 4) : 0;
        const reverseWeight = predictable * .85;
        const models = [
            { stop: Infinity, weight: .6 - reverseWeight * .6 },
            { stop: 6, weight: .25 - reverseWeight * .25 },
            { stop: 12, weight: .15 - reverseWeight * .15 }
        ];
        if (reverseWeight) models.push({ stop: Infinity, reverseAt: Math.max(2, period - run.age + 2), weight: reverseWeight });
        return models;
    }

    chooseShot(bot, task, waypoint) {
        const room = this.room, shooter = physical(bot);
        const shots = directions.map(direction => ({ direction,
            trace: trace(room, createBullet({ ...shooter, direction }, shooter.bulletSpeed), 80) }));
        const home = room.teamManager.getAllBases().find(base => base.team === bot.team && !base.isDead);
        const opponents = liveTanks(room).filter(target => target.team !== bot.team);
        let best = null;
        const consider = (shot, score) => {
            if (shot && score > 0 && (!best || score > best.score)) best = { ...shot, score };
        };
        for (const target of opponents) {
            const models = this.motionModels(target);
            const scores = new Map(directions.map(direction => [direction, 0]));
            const hazard = Math.max(.012, Math.min(.08, this.runs.get(target.id)?.turnRate ?? .025));
            const frozen = this.frozenFor(target);
            for (const model of models) {
                const preview = physical(target), hit = new Set();
                for (let tick = 1; tick <= 80; tick++) {
                    // The shell advances on its firing tick. The observed target
                    // has already reached its current position; do not move it twice.
                    if (tick > Math.max(1, frozen) && tick <= model.stop + 1) this.movePreview(preview,
                        model.reverseAt && tick >= model.reverseAt ? opposite[target.direction] : target.direction);
                    if ((target.shieldTimer || 0) >= tick) continue;
                    for (const shot of shots) {
                        const rect = shot.trace[tick];
                        const interior = { x: preview.x + 1, y: preview.y + 1,
                            width: preview.width - 2, height: preview.height - 2 };
                        if (!rect || hit.has(shot.direction) || !checkRectOverlap(rect, interior)) continue;
                        const solution = shotAt(room, shooter, shot.direction, preview);
                        if (!solution || solution.breach) continue;
                        hit.add(shot.direction);
                        const [mx, my] = DIRECTIONS[target.direction], [sx, sy] = DIRECTIONS[shot.direction];
                        const lateral = target.isMoving && Math.abs(mx * sy - my * sx) > 0;
                        const confidence = lateral ? Math.exp(-hazard * (model.reverseAt ? .35 : 1) * Math.max(0, tick - 8)) : 1;
                        const value = 122 + (home && distance(target, home) < 88 ? 40 : 0)
                            + (target.hp <= 1 ? 8 : 0) - tick * .35;
                        scores.set(shot.direction, scores.get(shot.direction) + model.weight * confidence * value);
                    }
                }
            }
            for (const shot of shots) if (scores.get(shot.direction) >= 18) {
                consider({ direction: shot.direction, breach: false }, scores.get(shot.direction));
            }
        }
        for (const base of room.teamManager.getAllBases()) {
            if (base.team === bot.team || base.isDead) continue;
            for (const direction of directions) {
                const shot = shotAt(room, shooter, direction, base);
                if (shot) consider(shot, (shot.breach ? 65 : 155) - shot.distance / 6);
            }
        }
        if (waypoint) {
            for (const direction of directions) {
                const shot = shotAt(room, shooter, direction, { ...waypoint, width: 16, height: 16 });
                if (shot?.breach) consider(shot, 40 - shot.distance / 8);
            }
        }
        for (const target of opponents) {
            // Do not open a defensive wall for an invulnerable opponent's benefit.
            if (target.shieldTimer > 24 && home && distance(target, home) < 96) continue;
            for (const direction of directions) {
                const shot = shotAt(room, shooter, direction, target);
                if (shot?.breach) consider(shot, 35 - shot.distance / 8);
            }
        }
        const interception = this.chooseInterception(bot, shots);
        if (interception) consider(interception, interception.score);
        return best;
    }

    chooseInterception(bot, cachedShots = null) {
        const room = this.room, shooter = physical(bot);
        const shots = cachedShots || directions.map(direction => ({ direction,
            trace: trace(room, createBullet({ ...shooter, direction }, shooter.bulletSpeed), HORIZON) }));
        let best = null;
        for (const bullet of room.bullets) {
            if (bullet.isDead || bullet.team === bot.team || distance(bot, bullet) > 112) continue;
            const incoming = trace(room, bullet, HORIZON);
            const tankDanger = incoming.findIndex(rect => rect && checkRectOverlap(bot, rect));
            const baseDanger = incoming.baseHit?.base.team === bot.team ? incoming.baseHit.tick : 0;
            const dangerTick = tankDanger > 0 && (bot.shieldTimer || 0) < tankDanger
                ? Math.min(tankDanger, baseDanger || Infinity) : baseDanger;
            if (dangerTick < 1) continue;
            for (const shot of shots) {
                for (let tick = 1; tick <= dangerTick; tick++) {
                    const rect = incoming[tick] || (incoming.baseHit?.tick === tick ? incoming.baseHit.rect : null);
                    if (!rect || !shot.trace[tick] || !checkRectOverlap(rect, shot.trace[tick])) continue;
                    const safe = shotAt(room, shooter, shot.direction, rect);
                    const score = (baseDanger ? 190 : 125) + Math.max(0, 16 - dangerTick) * 3 - tick;
                    if (safe && !safe.breach && (!best || score > best.score)) {
                        best = { ...safe, intercept: true, protectsBase: !!baseDanger, score };
                    }
                    break;
                }
            }
        }
        return best;
    }

    projectileCapacity(tank) {
        if (tank.projectileCapacity !== undefined) return tank.projectileCapacity;
        // These are the two weapon-state schemas used by the engine. They affect
        // legal firing capacity, never target value or movement priority.
        return tank.bulletTimer === undefined && tank.bulletCooldown !== undefined
            ? (tank.level >= 3 ? 2 : 1) : Infinity;
    }

    incoming(bot) {
        const room = this.room;
        const bullets = room.bullets.filter(bullet => !bullet.isDead);
        const actual = bullets.map(bullet => ({ ...bullet, trace: trace(room, bullet, HORIZON), predicted: false, delay: 0 }));
        const result = actual.filter(bullet => bullet.team !== bot.team && distance(bot, bullet) < 160);
        for (const target of liveTanks(room)) {
            if (target.team === bot.team || distance(bot, target) > 128) continue;
            if (this.frozenFor(target)) continue;
            let delay = cooldown(target);
            if (delay > 10) continue;
            const capacity = this.projectileCapacity(target);
            const occupied = actual.filter(bullet => bullet.ownerId === target.id);
            if (occupied.length >= capacity) {
                const frees = occupied.map(bullet => bullet.trace.length <= HORIZON ? bullet.trace.length : Infinity).sort((a, b) => a - b);
                delay = Math.max(delay, frees[occupied.length - capacity]);
                if (delay > 10) continue;
            }
            const preview = physical(target);
            for (let tick = 0; tick < delay; tick++) if (target.isMoving) this.movePreview(preview, target.direction);
            const bullet = createBullet(preview, preview.bulletSpeed);
            const positions = trace(room, bullet, HORIZON - delay);
            result.push({ ...bullet, predicted: true, delay: delay + 1,
                trace: Array(delay + 1).fill(null).concat(positions.slice(1)) });
        }
        return result;
    }

    trajectoryRisk(preview, direction, bullets, from, to) {
        let risk = 0;
        for (let tick = from; tick <= to; tick++) {
            this.movePreview(preview, direction);
            if ((preview.shieldTimer || 0) >= tick) continue;
            for (const bullet of bullets) {
                if (!bullet.trace[tick] || !checkRectOverlap(preview, bullet.trace[tick])) continue;
                risk = Math.max(risk, bullet.predicted ? 18 + (HORIZON - tick) * .5 : 400 + (HORIZON + 1 - tick) * 10);
            }
        }
        return risk;
    }

    combatMovementCost(bot, direction, { task } = {}) {
        const room = this.room;
        const home = room.teamManager.getAllBases().find(base => base.team === bot.team && !base.isDead);
        const opponents = liveTanks(room).filter(target => target.team !== bot.team)
            .sort((a, b) => distance(bot, a) - distance(bot, b));
        const target = opponents[0];
        if (!target || distance(bot, target) > 112) return 0;
        const defending = task?.kind === 'defend' && home && distance(target, home) < 104;
        if (task && !['fight', 'defend'].includes(task.kind) && distance(bot, target) > 40) return 0;
        const preview = physical(bot), future = physical(target);
        for (let tick = 0; tick < 8; tick++) {
            this.movePreview(preview, direction);
            if (target.isMoving && !this.frozenFor(target)) this.movePreview(future, target.direction);
        }
        const invulnerable = target.shieldTimer > 20;
        const ownReady = cooldown(bot) <= 8, enemyReady = cooldown(target) <= 10;
        const range = invulnerable ? 56 : ownReady ? 32 : 44;
        let cost = Math.abs(distance(preview, future) - range) * .15;
        const ownLane = directions.some(dir => {
            const shot = shotAt(room, preview, dir, future);
            return shot && !shot.breach;
        });
        if (ownReady && !invulnerable) {
            const cross = Math.min(Math.abs(preview.x - future.x), Math.abs(preview.y - future.y));
            cost += ownLane ? 0 : 4 + Math.min(24, cross) * .2;
        }
        if (enemyReady && bot.shieldTimer < 12) {
            const enemyLane = directions.some(dir => {
                const shot = shotAt(room, future, dir, preview);
                return shot && !shot.breach;
            });
            const aimed = shotAt(room, future, target.direction, preview);
            if (enemyLane) cost += ownReady && !invulnerable && ownLane ? 3 : 8;
            if (aimed && !aimed.breach) cost += 4;
        }
        if (defending && invulnerable) cost += distance(preview, home) * .1;
        if (direction && direction === bot.direction && bot.isMoving) cost -= .5;
        return Math.max(.01, cost);
    }
}

// Apply only chosen components to a navigation/coordination policy. Each experiment
// is opt-in: improvements in a synthetic aiming probe need not improve full games.
export function withCombatV4(Base, { aim = false, threats = false, steering = false, baseDefense = false } = {}) {
    return class CombatProfileV4 extends Base {
        reset() { super.reset(); this.runs = new Map(); }
        prepare() { super.prepare(); TacticalCombatV4.prototype.observeCombatMotion.call(this); }
        frozenFor(...args) { return TacticalCombatV4.prototype.frozenFor.apply(this, args); }
        movePreview(...args) { return TacticalCombatV4.prototype.movePreview.apply(this, args); }
        motionModels(...args) { return TacticalCombatV4.prototype.motionModels.apply(this, args); }
        projectileCapacity(...args) { return TacticalCombatV4.prototype.projectileCapacity.apply(this, args); }
        chooseInterception(...args) { return TacticalCombatV4.prototype.chooseInterception.apply(this, args); }
        chooseShot(...args) {
            if (aim) return TacticalCombatV4.prototype.chooseShot.apply(this, args);
            const shot = super.chooseShot(...args);
            if (!baseDefense) return shot;
            const intercept = this.chooseInterception(args[0]);
            return intercept?.protectsBase && (!shot || intercept.score > shot.score) ? intercept : shot;
        }
        incoming(...args) {
            return threats ? TacticalCombatV4.prototype.incoming.apply(this, args) : super.incoming(...args);
        }
        trajectoryRisk(...args) {
            return threats ? TacticalCombatV4.prototype.trajectoryRisk.apply(this, args) : super.trajectoryRisk(...args);
        }
        movementRisk(...args) {
            return threats ? TacticalV3.prototype.movementRisk.apply(this, args) : super.movementRisk(...args);
        }
        combatMovementCost(...args) {
            return steering ? TacticalCombatV4.prototype.combatMovementCost.apply(this, args)
                : (super.combatMovementCost?.(...args) ?? 0);
        }
    };
}
