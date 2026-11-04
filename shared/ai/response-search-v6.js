import { MAP_WIDTH, MAP_HEIGHT, TANK_STATS } from '../config.js';
import { createBullet } from '../bullet.js';
import { updateTankMovement } from '../tank.js';
import { checkRectOverlap } from '../utils.js';
import { DIRECTIONS, distance, liveTanks, shotAt, wallAt } from './geometry.js';

const directions = Object.keys(DIRECTIONS);
const opposite = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
const physical = tank => ({ id: tank.id, team: tank.team, x: tank.x, y: tank.y,
    width: tank.width || 16, height: tank.height || 16, hp: tank.hp || 1,
    speed: tank.speed, direction: tank.direction, level: tank.level || 1,
    isMoving: tank.isMoving, shieldTimer: tank.shieldTimer || 0,
    lastDirection: tank.lastDirection, slideTimer: tank.slideTimer,
    isDead: tank.isDead, isSpawning: tank.isSpawning,
    bulletSpeed: tank.bulletSpeed ?? TANK_STATS.player.levels[tank.level || 1].bulletSpeed,
    cooldown: Math.max(0, tank.bulletTimer ?? tank.bulletCooldown ?? 0) });
const key = action => `${action.move || '-'}:${action.fire || '-'}`;

// GameRoom updates players before every enemy, then enemies in array order.
// Use this only in this local model; frozen V3 forecasts remain untouched.
export function targetActsThisTick(room, shooter, target) {
    if (Object.values(room.players).some(player => player.id === target.id)) return false;
    const ownIndex = room.enemies.findIndex(tank => tank.id === shooter.id);
    const targetIndex = room.enemies.findIndex(tank => tank.id === target.id);
    return ownIndex >= 0 && targetIndex > ownIndex;
}

function responses(target, reactionTicks) {
    const perpendicular = ['UP', 'DOWN'].includes(target.direction) ? ['LEFT', 'RIGHT'] : ['UP', 'DOWN'];
    return [{ direction: target.isMoving ? target.direction : null, at: Infinity, label: 'continue' },
        ...reactionTicks.flatMap(at => [null, opposite[target.direction], ...perpendicular]
            .map(direction => ({ direction, at, label: `${direction || 'stop'}@${at}` })))];
}

function stepBullet(bullet, room) {
    if (bullet.isDead) return;
    const [dx, dy] = DIRECTIONS[bullet.direction], steps = Math.ceil(bullet.speed / 2);
    for (let step = 0; step < steps; step++) {
        if (wallAt(room.map, bullet)) { bullet.isDead = true; return; }
        bullet.x += dx * bullet.speed / steps;
        bullet.y += dy * bullet.speed / steps;
        if (bullet.x < 0 || bullet.y < 0 || bullet.x > MAP_WIDTH || bullet.y > MAP_HEIGHT) {
            bullet.isDead = true; return;
        }
    }
}

export function evaluateResponseAction(room, bot, target, action, response,
    options = { horizon: 16, commitTicks: 4 }) {
    const own = physical(bot), foe = physical(target);
    const view = Object.create(room);
    view.enemies = room.enemies.map(tank => tank.id === bot.id ? own : tank.id === target.id ? foe : physical(tank));
    view.players = Object.fromEntries(Object.entries(room.players).map(([id, tank]) => [id,
        tank.id === target.id ? foe : physical(tank)]));
    const collision = room.checkGlobalCollision.bind(view);
    const move = (tank, direction) => updateTankMovement(tank, direction, MAP_WIDTH, MAP_HEIGHT, room.map, collision);
    const bullets = room.bullets.filter(bullet => !bullet.isDead).map(bullet => ({ ...bullet }));
    const bases = room.teamManager.getAllBases().filter(base => !base.isDead);
    const targetIsPlayer = Object.values(room.players).some(player => player.id === target.id);
    const capacity = targetIsPlayer ? (foe.level >= 3 ? 2 : 1) : Infinity;
    const firstTargetTurn = targetActsThisTick(room, bot, target);
    const targetBefore = !firstTargetTurn;
    const clock = !targetIsPlayer && room.effectTimers.clockTeam !== foe.team ? room.effectTimers.clock : 0;
    let ownDamage = 0, targetDamage = 0, baseLoss = false, muzzle = null, firstTargetPosition = null;
    for (let tick = 1; tick <= options.horizon; tick++) {
        const targetTurn = () => {
            foe.shieldTimer = Math.max(0, foe.shieldTimer - 1);
            if (tick <= (clock || 0) || foe.isDead) return;
            const direction = tick >= response.at ? response.direction : target.isMoving ? target.direction : null;
            move(foe, direction);
            foe.cooldown = Math.max(0, foe.cooldown - 1);
            const line = !foe.cooldown && shotAt(view, foe, foe.direction, own);
            if (line && !line.breach && bullets.filter(bullet => !bullet.isDead && bullet.ownerId === foe.id).length < capacity) {
                bullets.push(createBullet(foe, foe.bulletSpeed));
                foe.cooldown = target.bulletCooldownMax ?? TANK_STATS.player.levels[foe.level].cooldown;
            }
        };
        if (tick > 1 && targetBefore) targetTurn();
        if (tick > 1) own.shieldTimer = Math.max(0, own.shieldTimer - 1);
        // The shot uses the real post-movement muzzle. Movement and shot can
        // share a direction, or a stationary bot can turn before firing.
        const speed = own.speed;
        if (tick === 1 && options.waypoint && action.move === desiredDirection(bot, options.waypoint)) {
            const axis = action.move === 'LEFT' || action.move === 'RIGHT' ? 'x' : 'y';
            own.speed = Math.min(speed, Math.abs(options.waypoint[axis] - own[axis]));
        }
        if (!own.isDead) move(own, tick <= options.commitTicks ? action.move : null);
        own.speed = speed;
        if (tick === 1 && action.fire && !own.isDead) {
            own.direction = action.fire;
            const shell = createBullet(own, own.bulletSpeed);
            muzzle = { x: shell.x, y: shell.y };
            bullets.push(shell);
        }
        if (!targetBefore && (tick > 1 || firstTargetTurn)) targetTurn();
        if (tick === 1) firstTargetPosition = { x: foe.x, y: foe.y };
        for (let index = bullets.length - 1; index >= 0; index--) stepBullet(bullets[index], room);
        for (const bullet of bullets) {
            if (bullet.isDead) continue;
            for (const other of bullets) {
                if (other !== bullet && !other.isDead && other.team !== bullet.team && checkRectOverlap(bullet, other)) {
                    bullet.isDead = other.isDead = true;
                }
            }
            if (bullet.isDead) continue;
            const base = bases.find(base => checkRectOverlap(bullet, base));
            if (base) {
                bullet.isDead = true;
                if (base.team === bot.team && bullet.team !== bot.team) baseLoss = true;
                continue;
            }
            for (const tank of [...view.enemies, ...Object.values(view.players)]) {
                if (tank.isDead || tank.isSpawning || tank.team === bullet.team || !checkRectOverlap(bullet, tank)) continue;
                bullet.isDead = true;
                if (!tank.shieldTimer) {
                    tank.hp--;
                    if (tank === own) ownDamage++;
                    if (tank === foe) targetDamage++;
                    if (tank.hp <= 0) tank.isDead = true;
                }
                break;
            }
        }
    }
    return { ownDamage, targetDamage, targetKilled: !!foe.isDead, baseLoss, muzzle, firstTargetPosition,
        distance: distance(own, foe), cross: Math.min(Math.abs(own.x - foe.x), Math.abs(own.y - foe.y)) };
}

// A deliberately small response set, not a complete minimax tree. Terrain is
// held fixed; a projectile is absorbed by the first wall, and no breach value
// is claimed. Callers should keep their existing strategic/breaching decisions.
export function searchResponses(room, bot, target, {
    horizon = 12, commitTicks = 4, reactionTicks = [2, 6], maxTransitions = 1024,
    baseline = { move: null, fire: null }, movementRisk = () => 0, waypoint = null
} = {}) {
    const options = { horizon, commitTicks, waypoint };
    const answers = responses(target, reactionTicks);
    // Keep the inherited shot and current clean axes. Looking at all four
    // speculative firing directions multiplied cost without testing a useful
    // new escape constraint in the common single-contact case.
    const fireDirections = [...new Set([baseline.fire, ...directions.filter(direction => {
        const shot = shotAt(room, bot, direction, target);
        return shot && !shot.breach;
    })].filter(Boolean))].slice(0, 2);
    if (!fireDirections.length) fireDirections.push(Math.abs(target.x - bot.x) > Math.abs(target.y - bot.y)
        ? target.x > bot.x ? 'RIGHT' : 'LEFT' : target.y > bot.y ? 'DOWN' : 'UP');
    const actions = [baseline, { move: null, fire: null },
        ...directions.map(move => ({ move, fire: null })),
        ...fireDirections.map(fire => ({ move: null, fire })),
        ...fireDirections.map(direction => ({ move: direction, fire: direction }))]
        .filter((action, index, all) => all.findIndex(other => key(other) === key(action)) === index)
        .filter(action => !action.fire || bot.bulletTimer <= 0);
    const results = [];
    let transitions = 0;
    for (const action of actions) {
        if (transitions + answers.length * horizon > maxTransitions) break;
        const risk = movementRisk(action.move);
        if (risk >= 400) { results.push({ ...action, score: -1000 - risk, answers: 0 }); continue; }
        const outcomes = answers.map(answer => evaluateResponseAction(room, bot, target, action, answer, options));
        transitions += answers.length * horizon;
        const average = field => outcomes.reduce((sum, outcome) => sum + Number(outcome[field]), 0) / outcomes.length;
        const damage = average('targetDamage'), loss = average('ownDamage');
        const score = damage * 90 + average('targetKilled') * 35 - loss * 170
            - Math.max(...outcomes.map(outcome => outcome.ownDamage)) * 35 - average('baseLoss') * 1000
            + (distance(bot, target) - average('distance')) * .25 - average('cross') * .15 - Math.min(30, risk) * .3;
        results.push({ ...action, score, damage, ownDamage: loss, answers: outcomes.length,
            safeResponses: outcomes.filter(outcome => !outcome.targetDamage).length });
    }
    const best = results.reduce((best, result) => !best || result.score > best.score ? result : best, null);
    return { best, baseline: results.find(result => key(result) === key(baseline)), actions: results,
        transitions, responses: answers.map(answer => answer.label), horizon };
}

const desiredDirection = (bot, waypoint) => !waypoint ? null : Math.abs(waypoint.x - bot.x) > .05
    ? waypoint.x > bot.x ? 'RIGHT' : 'LEFT' : Math.abs(waypoint.y - bot.y) > .05 ? waypoint.y > bot.y ? 'DOWN' : 'UP' : null;

export function withResponseSearch(Base, { maxDistance = 64, every = 12, maxSearchesPerTeamPerTick = 1,
    maxTransitions = 1024, horizon = 12, commitTicks = 4, improvement = 4 } = {}) {
    return class ReactiveResponseV6 extends Base {
        reset() { super.reset(); this.responsePlans = new Map(); this.responseBudget = { tick: -1, teams: new Map() }; }
        prepare() {
            super.prepare();
            const alive = new Set(this.room.enemies.map(tank => tank.id));
            for (const id of this.responsePlans.keys()) if (!alive.has(id)) this.responsePlans.delete(id);
        }
        responsePlan(bot, task, waypoint, inheritedShot, bullets) {
            const exposedBase = inheritedShot && this.room.teamManager.getAllBases().some(base => base.team !== bot.team
                && !base.isDead && shotAt(this.room, bot, inheritedShot.direction, base)?.breach === false);
            if (task?.screen || (task && !['fight', 'defend'].includes(task.kind))
                || inheritedShot?.intercept || inheritedShot?.breach || exposedBase) {
                this.responsePlans.delete(bot.id);
                return null;
            }
            const existing = this.responsePlans.get(bot.id);
            if (existing && this.tick - existing.searched < every) return this.tick <= existing.until ? existing : null;
            const target = liveTanks(this.room).filter(tank => tank.team !== bot.team && tank.shieldTimer < horizon
                && distance(bot, tank) <= Math.min(maxDistance, bot.bulletSpeed * horizon + 16)
                && Math.max(bot.bulletSpeed, physical(tank).bulletSpeed) >= 250 / 60)
                .sort((a, b) => distance(bot, a) - distance(bot, b))[0];
            if (!target) return null;
            if (this.responseBudget.tick !== this.tick) this.responseBudget = { tick: this.tick, teams: new Map() };
            // Identical limits with one shared controller or separate policies:
            // enemy update ordering must not let one team consume both quotas.
            const used = this.responseBudget.teams.get(bot.team) || 0;
            if (used >= maxSearchesPerTeamPerTick) return null;
            this.responseBudget.teams.set(bot.team, used + 1);
            const desired = desiredDirection(bot, waypoint);
            const baseline = { move: inheritedShot && inheritedShot.direction !== desired ? null : desired,
                fire: inheritedShot?.direction || null };
            const search = searchResponses(this.room, bot, target, { horizon, commitTicks, maxTransitions, baseline, waypoint,
                movementRisk: direction => super.movementRisk(bot, direction, bullets) });
            const selected = search.best && search.baseline && search.best.score >= search.baseline.score + improvement
                ? search.best : null;
            const plan = { selected, searched: this.tick, until: this.tick + Math.min(3, commitTicks - 1),
                targetId: target.id, search };
            this.responsePlans.set(bot.id, plan);
            return plan;
        }
        chooseShot(bot, task, waypoint) {
            const inherited = super.chooseShot(bot, task, waypoint);
            const plan = this.responsePlan(bot, task, waypoint, inherited, this.incoming(bot));
            if (!plan?.selected) return inherited;
            if (!plan.selected.fire) return null;
            // Fire geometry is valid only at the state on which it was searched.
            // On later ticks retain movement preference and let the base aim again.
            if (plan.searched !== this.tick) return inherited;
            return { direction: plan.selected.fire, score: inherited?.score || 100, responseSearch: true };
        }
        combatMovementCost(bot, direction, context = {}) {
            const inherited = super.combatMovementCost(bot, direction, context);
            const plan = this.responsePlans.get(bot.id);
            if (!plan?.selected || this.tick > plan.until || context.task?.screen
                || context.shot?.intercept || context.shot?.breach) return inherited;
            if (context.shot && !context.shot.responseSearch && context.shot.direction !== plan.selected.fire) return inherited;
            return inherited + (direction === plan.selected.move ? 0 : 9);
        }
    };
}
