import { PlayerProxy } from './player-proxy.js';
import { seededRandom } from '../shared/random.js';
import { TANK_STATS, MAP_WIDTH, MAP_HEIGHT } from '../shared/config.js';
import { updateTankMovement } from '../shared/tank.js';
import { checkRectOverlap } from '../shared/utils.js';
import { DIRECTIONS, distance, shotAt, wallAt } from '../shared/ai/geometry.js';

export const REACTIVE_ADVERSARY_VERSION = 'reactive-input-v1';
export const REACTIVE_PLAYER_POLICIES = Object.freeze(['reactive-dodge', 'switch-rush', 'bait-corner']);
export const REACTIVE_DEFAULTS = Object.freeze({ delays: Object.freeze([2, 4, 7]), continueProbability: .25,
    dodgeTicks: 12, switchTicks: 180, peekTicks: 12 });

const packet = (direction, fire = false) => ({ up: direction === 'UP', down: direction === 'DOWN',
    left: direction === 'LEFT', right: direction === 'RIGHT', fire, cheat0: false });
const directionOf = input => input.up ? 'UP' : input.down ? 'DOWN' : input.left ? 'LEFT' : input.right ? 'RIGHT' : null;
const fields = ['id', 'team', 'x', 'y', 'width', 'height', 'direction', 'speed', 'hp', 'level', 'isMoving',
    'isDead', 'isSpawning', 'lives', 'shieldTimer', 'bulletCooldown', 'bulletTimer', 'bulletSpeed',
    'bulletCooldownMax', 'lastDirection', 'slideTimer'];
const physical = tank => Object.fromEntries(fields.map(key => [key, tank[key]]));

// The frozen planner receives public physical snapshots, never an enemy input
// packet. Its private previews/output arrays cannot mutate the actual room.
function publicRoom(room) {
    const view = Object.create(room);
    Object.defineProperties(view, {
        enemies: { get: () => room.enemies.map(physical) },
        players: { get: () => Object.fromEntries(Object.entries(room.players).map(([id, tank]) => [id, physical(tank)])) },
    });
    view.checkGlobalCollision = room.checkGlobalCollision.bind(room);
    return view;
}

function preview(room, player, direction, ticks) {
    const tank = physical(player);
    for (let tick = 0; tick < ticks; tick++) updateTankMovement(tank, direction, MAP_WIDTH, MAP_HEIGHT,
        room.map, room.checkGlobalCollision.bind(room));
    return tank;
}

// Predict only existing projectiles against ordinary movement. No random game
// generator, enemy timers, future inputs or real entities are modified here.
function risk(room, player, direction, projectiles, horizon = 24) {
    const tank = physical(player);
    const bullets = projectiles.map(bullet => ({ ...bullet }));
    let penalty = 0;
    for (let tick = 1; tick <= horizon; tick++) {
        updateTankMovement(tank, direction, MAP_WIDTH, MAP_HEIGHT, room.map, room.checkGlobalCollision.bind(room));
        for (const bullet of bullets) {
            if (bullet.isDead) continue;
            const [dx, dy] = DIRECTIONS[bullet.direction];
            const steps = Math.ceil(bullet.speed / 2);
            for (let step = 0; step < steps; step++) {
                if (wallAt(room.map, bullet)) { bullet.isDead = true; break; }
                bullet.x += dx * bullet.speed / steps;
                bullet.y += dy * bullet.speed / steps;
                if (bullet.x < 0 || bullet.y < 0 || bullet.x > MAP_WIDTH || bullet.y > MAP_HEIGHT) { bullet.isDead = true; break; }
            }
            if (!bullet.isDead && checkRectOverlap(tank, bullet)) penalty = Math.max(penalty, 400 + (horizon - tick) * 10);
        }
    }
    return penalty;
}

function canShoot(room, player, direction, targets) {
    const shooter = { ...physical(player), bulletSpeed: TANK_STATS.player.levels[player.level || 1].bulletSpeed };
    return targets.some(target => {
        const shot = shotAt(room, shooter, direction, target);
        return shot && !shot.breach;
    });
}

export class ReactivePlayerProxy {
    constructor(room, id, { policy = 'reactive-dodge', seed = 1, reaction = 3,
        delays = REACTIVE_DEFAULTS.delays, continueProbability = REACTIVE_DEFAULTS.continueProbability,
        dodgeTicks = REACTIVE_DEFAULTS.dodgeTicks, switchTicks = REACTIVE_DEFAULTS.switchTicks,
        peekTicks = REACTIVE_DEFAULTS.peekTicks } = {}) {
        if (!REACTIVE_PLAYER_POLICIES.includes(policy)) throw new Error(`Unknown reactive policy: ${policy}`);
        if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw new Error('Adversary seed must be uint32');
        for (const [name, value] of Object.entries({ reaction, dodgeTicks, switchTicks, peekTicks })) {
            if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
        }
        if (!Array.isArray(delays) || !delays.length || delays.some(delay => !Number.isSafeInteger(delay) || delay < 1)) throw new Error('delays must contain positive integer ticks');
        if (!Number.isFinite(continueProbability) || continueProbability < 0 || continueProbability > 1) throw new Error('continueProbability must be 0..1');
        Object.assign(this, { room, id, policy, reaction, dodgeTicks, switchTicks, peekTicks, continueProbability });
        this.delays = [...delays];
        this.random = seededRandom(seed);
        this.tick = 0;
        this.inputs = packet(null);
        this.seen = new WeakSet();
        this.pending = [];
        this.dodge = null;
        this.bait = null;
        this.feintUntil = 0;
        this.continueUntil = 0;
        this.continueDirection = null;
        this.reactionSamples = [];
        this.phase = null;
        this.stats = { bulletsObserved: 0, threateningShots: 0, scheduledReactions: 0, continuedShots: 0,
            reactions: 0, canceledReactions: 0, phaseSwitches: 0, peeks: 0, retreats: 0, delays: {} };
        const view = publicRoom(room);
        this.duelist = new PlayerProxy(view, id, { policy: 'duelist', reaction });
        this.rusher = new PlayerProxy(view, id, { policy: 'rusher', reaction });
        // Pursuit/aiming use the frozen v2 planner. Only the new controller can
        // initiate dodging, after observing a real enemy projectile.
        this.duelist.controller.incoming = this.rusher.controller.incoming = () => [];
    }

    diagnostics() { return { version: REACTIVE_ADVERSARY_VERSION, policy: this.policy, ...this.stats,
        delays: { ...this.stats.delays }, reactionSamples: this.reactionSamples.map(sample => ({ ...sample })) }; }

    observe(player, baselineDirection, bullets) {
        for (const bullet of bullets) {
            if (this.seen.has(bullet)) continue;
            this.seen.add(bullet);
            this.stats.bulletsObserved++;
            if (!risk(this.room, player, baselineDirection, [bullet]) && !risk(this.room, player, null, [bullet])) continue;
            this.stats.threateningShots++;
            if (this.random() < this.continueProbability) {
                this.stats.continuedShots++;
                this.continueDirection = directionOf(this.inputs);
                this.continueUntil = this.tick + this.dodgeTicks;
                continue;
            }
            const delay = this.delays[Math.floor(this.random() * this.delays.length)];
            this.pending.push({ bullet, observedTick: this.tick, due: this.tick + delay, bias: this.random() < .5 });
            this.stats.scheduledReactions++;
            this.stats.delays[delay] = (this.stats.delays[delay] || 0) + 1;
        }
    }

    dodgeDirection(player, source, bullets, bias) {
        const vertical = source.direction === 'UP' || source.direction === 'DOWN';
        let choices = vertical ? ['LEFT', 'RIGHT'] : player.team === 1 ? ['UP', 'DOWN'] : ['DOWN', 'UP'];
        if (bias) choices.reverse();
        let best = null, bestCost = Infinity;
        for (const direction of [...choices, directionOf(this.inputs), null]) {
            const next = preview(this.room, player, direction, 6);
            const moved = distance(player, next);
            const cost = risk(this.room, player, direction, bullets) + (direction && moved < .1 ? 20 : 0)
                + (choices.includes(direction) ? 0 : 3) - Math.min(4, moved) / 4;
            if (cost < bestCost) { bestCost = cost; best = direction; }
        }
        return best;
    }

    baitDirection(player, baselineDirection, enemies) {
        if (this.bait?.retreatUntil > this.tick) {
            const anchor = this.bait.anchor;
            if (Math.abs(anchor.x - player.x) > .5) return anchor.x > player.x ? 'RIGHT' : 'LEFT';
            if (Math.abs(anchor.y - player.y) > .5) return anchor.y > player.y ? 'DOWN' : 'UP';
            this.bait = null;
        }
        if (this.bait?.peekUntil > this.tick) return this.bait.direction;
        if (this.bait) {
            this.bait.retreatUntil = this.tick + this.peekTicks * 2;
            this.stats.retreats++;
            return this.baitDirection(player, baselineDirection, enemies);
        }
        if (this.tick % this.reaction || !enemies.length) return baselineDirection;
        const target = enemies[0];
        const exposed = Object.keys(DIRECTIONS).some(direction => {
            const shot = shotAt(this.room, target, direction, player);
            return shot && !shot.breach;
        });
        if (exposed) return baselineDirection;
        let best = null;
        for (const direction of Object.keys(DIRECTIONS)) {
            const next = preview(this.room, player, direction, this.peekTicks);
            const moved = distance(player, next);
            if (moved < 2 || !Object.keys(DIRECTIONS).some(fire => canShoot(this.room, next, fire, enemies))) continue;
            const score = moved + distance(next, target) / 8;
            if (!best || score < best.score) best = { direction, score };
        }
        if (!best) return baselineDirection;
        this.bait = { anchor: { x: player.x, y: player.y }, direction: best.direction, peekUntil: this.tick + this.peekTicks };
        this.stats.peeks++;
        return best.direction;
    }

    decide() {
        this.tick++;
        const player = this.room.players[this.id];
        if (!player || player.isDead || player.isSpawning) {
            this.pending = [];
            this.dodge = this.bait = null;
            this.continueUntil = 0;
            this.duelist.decide(); this.rusher.decide();
            return this.inputs = packet(null);
        }
        const enemies = this.room.enemies.filter(tank => tank.team !== player.team && !tank.isDead).map(physical)
            .sort((a, b) => distance(player, a) - distance(player, b));
        const phaseTick = this.tick % (this.switchTicks * 3);
        const rushing = this.policy === 'switch-rush' && phaseTick >= this.switchTicks
            && phaseTick < this.switchTicks * 2 && this.tick >= this.feintUntil;
        const phase = rushing ? 'rusher' : 'duelist';
        if (this.phase !== null && this.phase !== phase) this.stats.phaseSwitches++;
        this.phase = phase;
        const duel = this.duelist.decide(), rush = this.rusher.decide();
        const baseline = rushing ? rush : duel;
        let direction = directionOf(baseline);
        const bullets = this.room.bullets.filter(bullet => !bullet.isDead && bullet.team !== player.team && distance(player, bullet) < 160).slice(0, 12);
        this.observe(player, direction, bullets);
        const due = this.pending.find(episode => episode.due <= this.tick);
        if (due) {
            this.pending = this.pending.filter(episode => episode !== due);
            if (!due.bullet.isDead && this.room.bullets.includes(due.bullet)) {
                this.dodge = { direction: this.dodgeDirection(player, due.bullet, bullets, due.bias), until: this.tick + this.dodgeTicks,
                    source: due.bullet, bias: due.bias };
                this.stats.reactions++;
                if (this.reactionSamples.length < 64) this.reactionSamples.push({ observedTick: due.observedTick,
                    reactedTick: this.tick, requestedDelay: due.due - due.observedTick, actualDelay: this.tick - due.observedTick });
                if (this.policy === 'switch-rush') this.feintUntil = this.tick + 60;
                if (this.bait) { this.bait.retreatUntil = this.tick + this.peekTicks * 2; this.stats.retreats++; }
            } else this.stats.canceledReactions++;
        }
        if (this.policy === 'bait-corner') direction = this.baitDirection(player, direction, enemies);
        if (this.dodge?.until > this.tick) {
            if (risk(this.room, player, this.dodge.direction, bullets) > 0) {
                this.dodge.direction = this.dodgeDirection(player, this.dodge.source, bullets, this.dodge.bias);
            }
            direction = this.dodge.direction;
        }
        if (this.continueUntil > this.tick) direction = this.continueDirection;
        const fireDirection = direction || player.direction;
        const bases = rushing ? this.room.teamManager.getAllBases().filter(base => base.team !== player.team && !base.isDead) : [];
        const fire = (direction === directionOf(baseline) && baseline.fire)
            || canShoot(this.room, player, fireDirection, [...enemies, ...bases]);
        return this.inputs = packet(direction, fire);
    }
}
