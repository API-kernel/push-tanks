import { BASE_WALLS, MAP_WIDTH, MAP_HEIGHT, TANK_SMART_ALIGN_SPEED } from '../config.js';
import { checkRectOverlap } from '../utils.js';
import { DIRECTIONS, wallAt } from './geometry.js';

const HORIZON = 28;
const rect = tank => ({ x: tank.x, y: tank.y, width: tank.width || 16, height: tank.height || 16 });
const gap = (a, b) => Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width)
    + Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height);
const moveBound = tank => Math.max(tank.speed || 0,
    Math.min(3, (tank.speed || 0) * TANK_SMART_ALIGN_SPEED));

function possibleTargets(room, team) {
    const targets = room.enemies.filter(tank => tank.team !== team && !tank.isDead)
        .map(tank => ({ tank, appears: 0 }));
    for (const tank of Object.values(room.players)) {
        if (tank.team <= 0 || tank.team === team || tank.isDead) continue;
        targets.push({ tank, appears: tank.isSpawning ? Math.max(1, 61 - tank.spawnAnimTimer) : 0 });
    }
    for (const pending of room.pendingSpawns || []) {
        if (pending.team === team) continue;
        // Chassis selection happens at spawn. Use the largest ordinary movement
        // bound instead of guessing which random chassis will appear.
        targets.push({ tank: { ...pending, width: 16, height: 16, speed: 1 }, appears: Math.max(1, 61 - pending.timer) });
    }
    return targets;
}

// This is a LOWER bound on removal time, not a claim that a simulated collision
// will happen. Reachability ignores blockers, and allows hostile tanks to turn,
// move with smart alignment, and fire the fastest weapon immediately. That may
// retain an unnecessary prediction; it must not hide a physically possible one.
export function earliestPossibleRemoval(room, source, horizon = HORIZON) {
    const bullet = { ...source, width: source.width || 4, height: source.height || 4 };
    const vector = DIRECTIONS[bullet.direction];
    if (!vector || !(bullet.speed > 0)) return 1;
    const [dx, dy] = vector, steps = Math.ceil(bullet.speed / 2);
    const targets = possibleTargets(room, bullet.team);
    const hostile = room.bullets.filter(other => !other.isDead && other.team !== bullet.team);
    const bases = room.teamManager.getAllBases().filter(base => !base.isDead);
    const baseWalls = room.settings.basesEnabled ? Object.values(BASE_WALLS).flat() : [];
    for (let tick = 1; tick <= horizon; tick++) {
        for (let step = 0; step < steps; step++) {
            if (wallAt(room.map, bullet)) return tick;
            bullet.x += dx * bullet.speed / steps;
            bullet.y += dy * bullet.speed / steps;
            if (bullet.x < 0 || bullet.y < 0 || bullet.x > MAP_WIDTH || bullet.y > MAP_HEIGHT) return tick;
            // Fortifications can be restored by a shovel. Conservatively allow
            // that event instead of proving a slot stays occupied across a base zone.
            if (baseWalls.some(cell => checkRectOverlap(bullet,
                { x: cell.c * 8, y: cell.r * 8, width: 8, height: 8 }))) return tick;
        }
        if (bases.some(base => checkRectOverlap(bullet, base))) return tick;
        for (const other of hostile) {
            const direction = DIRECTIONS[other.direction];
            if (!direction) return tick;
            if (checkRectOverlap(bullet, { x: other.x + direction[0] * other.speed * tick,
                y: other.y + direction[1] * other.speed * tick, width: other.width || 4, height: other.height || 4 })) return tick;
        }
        for (const { tank, appears } of targets) {
            if (tick < appears) continue;
            const elapsed = tick - appears + 1;
            const distance = gap(bullet, rect(tank));
            const movement = moveBound(tank) * elapsed;
            if (distance <= movement) return tick; // A shield also consumes the shell.
            const projectileReach = Math.max(250 / 60, tank.bulletSpeed || 0) * elapsed;
            if (distance <= movement + projectileReach + 4) return tick;
        }
    }
    return horizon + 1;
}

export function earliestPossibleAmmoSlot(room, player, horizon = HORIZON) {
    const capacity = player.level >= 3 ? 2 : 1;
    const occupied = room.bullets.filter(bullet => !bullet.isDead && bullet.ownerId === player.id);
    if (occupied.length < capacity) return 1;
    const removals = occupied.map(bullet => earliestPossibleRemoval(room, bullet, horizon)).sort((a, b) => a - b);
    // The player has already had its turn. A shell removed by wall/tank/clash
    // collisions at endpoint t opens a slot for updatePlayer at endpoint t+1.
    let earliest = removals[occupied.length - capacity] + 1;
    const bonus = room.activeBonus;
    if (player.level < 3 && bonus && (bonus.type === 'gun' || (bonus.type === 'star' && player.level === 2))) {
        const travel = Math.ceil(gap(rect(player), { ...bonus, width: 16, height: 16 }) / Math.max(.001, moveBound(player)));
        earliest = Math.min(earliest, travel + 2); // Collection precedes player movement.
    }
    // A bonus tank can drop a capacity upgrade at an unpredictable position.
    // Retain next-tick danger rather than assuming its future bonus is harmless.
    if (player.level < 3 && room.enemies.some(tank => tank.isBonus && tank.team !== player.team)) earliest = Math.min(earliest, 2);
    return earliest;
}

function delayPrediction(prediction, shift) {
    if (!shift) return prediction;
    if (prediction.trace) {
        const trace = Array(Math.min(shift, prediction.trace.length)).fill(null)
            .concat(prediction.trace).slice(0, prediction.trace.length);
        if (!trace.some(Boolean)) return null;
        return { ...prediction, delay: prediction.delay + shift, trace };
    }
    const delay = prediction.delay + shift;
    return delay >= HORIZON ? null : { ...prediction, delay };
}

// The two repairs are independent ablations. All inherited risk weights,
// real projectiles and trajectory samples remain unchanged.
export function withFireAvailability(Base, { capacity = true, clock = true } = {}) {
    return class FireAvailabilityV6 extends Base {
        incoming(bot) {
            const inherited = super.incoming(bot);
            if (!capacity && !clock) return inherited;
            const room = this.room;
            const players = new Map(Object.values(room.players).map(player => [player.id, player]));
            const bots = new Map(room.enemies.map(tank => [tank.id, tank]));
            const availability = new Map();
            return inherited.flatMap(prediction => {
                if (!prediction.predicted) return [prediction];
                const player = players.get(prediction.ownerId), enemy = bots.get(prediction.ownerId);
                let first = prediction.trace ? prediction.trace.findIndex(Boolean) : prediction.delay + 1;
                if (first < 1) return [prediction];
                let shift = 0;
                if (clock && enemy && room.effectTimers.clock > 0 && room.effectTimers.clockTeam !== enemy.team) {
                    shift = room.effectTimers.clock; // Frozen bots do not decrement cooldown either.
                }
                if (capacity && player) {
                    if (!availability.has(player.id)) availability.set(player.id, earliestPossibleAmmoSlot(room, player));
                    shift = Math.max(shift, availability.get(player.id) - first);
                }
                const delayed = delayPrediction(prediction, Math.max(0, shift));
                return delayed ? [delayed] : [];
            });
        }
    };
}
