import { createBullet } from '../bullet.js';
import { checkRectOverlap } from '../utils.js';
import { DIRECTIONS, distance, liveTanks, shotAt } from './geometry.js';
import { clearPointV6, physicalV6, setTaskV6, strategyFields, weaponTiming } from './timing-path-v6.js';

// All walls on a line matter. A near opponent behind unbreakable concrete
// cannot outrank a farther shooter with an already exposed base line.
export function baseLaneTimingV6(room, tank, base, position = tank) {
    const timing = weaponTiming(tank), shooter = { ...physicalV6(tank), x: position.x, y: position.y };
    let best = null;
    for (const direction of Object.keys(DIRECTIONS)) {
        const solution = shotAt(room, shooter, direction, base);
        if (!solution) continue;
        const bullet = createBullet({ ...shooter, direction }, timing.bulletSpeed), [dx, dy] = DIRECTIONS[direction];
        const planes = new Map(), rect = { ...bullet };
        let blocked = false;
        for (let d = 0; d <= solution.distance; d += 2) {
            rect.x = bullet.x + dx * d; rect.y = bullet.y + dy * d;
            for (let r = Math.floor(rect.y / 8); r <= Math.floor((rect.y + 3.999) / 8); r++) {
                for (let c = Math.floor(rect.x / 8); c <= Math.floor((rect.x + 3.999) / 8); c++) {
                    const cell = room.map[r]?.[c];
                    if (![1, 2].includes(cell?.type) || !cell.mask) continue;
                    for (let bit = 0; bit < 4; bit++) {
                        const block = { x: c * 8 + bit % 2 * 4, y: r * 8 + Math.floor(bit / 2) * 4, width: 4, height: 4 };
                        if (!(cell.mask & 1 << bit) || !checkRectOverlap(rect, block)) continue;
                        if (room.teamManager.isInBaseZone(tank.team, r, c) || (cell.type === 2 && (tank.level || 1) < 4)) blocked = true;
                        const axis = dx ? block.x : block.y;
                        planes.set(axis, Math.max(planes.get(axis) || 0, cell.isBaseWall && room.settings.vibraniumBase ? 10 : 1));
                    }
                }
            }
        }
        if (blocked) continue;
        const values = [...planes.values()];
        let shots = 0;
        for (let i = 0; i < values.length; i += timing.depth / 4) shots += Math.max(...values.slice(i, i + timing.depth / 4));
        const ticks = shots * timing.cooldown + solution.distance / timing.bulletSpeed;
        if (!best || ticks < best.ticks) best = { ...solution, ticks, shots, origin: { x: position.x, y: position.y }, bullet };
    }
    return best;
}

export function estimateBaseThreatV6(room, target, base, field) {
    const timing = weaponTiming(target);
    const frozen = room.enemies.includes(target) && room.effectTimers?.clock > 0
        && room.effectTimers.clockTeam !== target.team ? room.effectTimers.clock : 0;
    const consider = (p, arrival) => {
        const lane = baseLaneTimingV6(room, target, base, p);
        if (!lane) return null;
        const fatalTicks = frozen + Math.max(arrival, timing.ready) + lane.ticks;
        return { target, ...lane, arrivalTicks: arrival + frozen, fatalTicks };
    };
    let best = consider(target, 0);
    if (!field) return best;
    // Only the two grid lanes crossing each side of this 8px base can fire at
    // it. At most 100 positions; no per-node all-map ray tracing.
    const candidates = new Map();
    for (let coordinate = 0; coordinate <= 192; coordinate += 8) {
        for (const x of [base.x - 8, base.x]) if (x >= 0 && x <= 192) candidates.set(`${x}:${coordinate}`, { x, y: coordinate });
        for (const y of [base.y - 8, base.y]) if (y >= 0 && y <= 192) candidates.set(`${coordinate}:${y}`, { x: coordinate, y });
    }
    for (const p of candidates.values()) {
        const arrival = field.ticksAt ? field.ticksAt(p) : field.at(p).ticks;
        if (!Number.isFinite(arrival) || (best && frozen + arrival >= best.fatalTicks)) continue;
        const candidate = consider(p, arrival);
        if (candidate && (!best || candidate.fatalTicks < best.fatalTicks)) best = candidate;
    }
    return best;
}

function screenPoints(threat, home) {
    const vertical = ['UP', 'DOWN'].includes(threat.direction), result = [];
    if (vertical) {
        const x = Math.round((threat.bullet.x - 6) / 8) * 8;
        for (const offset of [24, 40, 56]) result.push({ x, y: home.y + (home.y === 0 ? offset : -offset) });
    } else {
        const y = Math.round((threat.bullet.y - 7) / 8) * 8;
        for (const offset of [24, 40, 56]) result.push({ x: home.x + (threat.origin.x < home.x ? -offset : offset), y });
    }
    return result.filter(p => {
        // A screen must lie between the prospective muzzle and the base.
        const [dx, dy] = DIRECTIONS[threat.direction];
        return (p.x + 8 - threat.bullet.x) * dx + (p.y + 8 - threat.bullet.y) * dy > 0;
    });
}

export function withObjectiveTimingV6(Base, { enabled = true, horizon = 160 } = {}) {
    return class ObjectiveTimingV6 extends Base {
        reset() { super.reset(); this.timingThreatsV6 = new Map(); }
        assignTasks() {
            super.assignTasks();
            this.timingThreatsV6.clear();
            if (!enabled || !this.room.settings.basesEnabled) return;
            const room = this.room, all = liveTanks(room);
            for (const home of room.teamManager.getAllBases().filter(base => !base.isDead)) {
                const fields = strategyFields(this, 'objectives', 8, home.team);
                const opponents = all.filter(target => target.team !== home.team);
                // Exposed firing lines are ranked before proximity. The two
                // selected threats get complete, bounded route estimates.
                const ranked = opponents.map(target => {
                    const direct = baseLaneTimingV6(room, target, home);
                    return { target, lower: direct ? weaponTiming(target).ready + direct.ticks
                        : distance(target, home) / Math.max(.1, target.speed || .6) };
                }).sort((a, b) => a.lower - b.lower).slice(0, 2);
                const threats = ranked.map(({ target }) => estimateBaseThreatV6(room, target, home,
                    fields.get(target, { allowBreach: true, crowd: false })))
                    .filter(threat => threat && threat.fatalTicks <= horizon).sort((a, b) => a.fatalTicks - b.fatalTicks);
                this.timingThreatsV6.set(home.team, threats);
                const bots = room.enemies.filter(bot => bot.team === home.team), used = new Set(), points = [];
                const defenders = bots.filter(bot => this.tasks.get(bot.id)?.kind !== 'bonus')
                    .sort((a, b) => {
                        const bid = bot => Math.min(Infinity, ...threats.flatMap(threat => screenPoints(threat, home))
                            .map(point => distance(bot, point) / Math.max(.1, bot.speed || .6)))
                            - (this.tasks.get(bot.id)?.screen ? 24 : this.tasks.get(bot.id)?.kind === 'defend' ? 12 : 0);
                        return bid(a) - bid(b);
                    }).slice(0, 2);
                for (const threat of threats) {
                    let winner = null;
                    for (const bot of defenders) {
                        if (used.has(bot.id) || this.tasks.get(bot.id)?.kind === 'bonus') continue;
                        const task = this.tasks.get(bot.id);
                        // Retain a useful V5 shield screen. A second approach
                        // can recruit another defender, never this one again.
                        if (task?.screen && task.screenThreatId !== threat.target.id
                            && threats.some(t => t.target.id === task.screenThreatId)) continue;
                        const field = fields.get(bot, { crowd: false });
                        if (!field) continue;
                        for (const point of screenPoints(threat, home)) {
                            if (!clearPointV6(room, bot, point) || points.some(p => distance(p, point) < 16)) continue;
                            if (all.some(t => t.id !== bot.id && t.team === bot.team
                                && Math.abs(t.x - point.x) < 14 && Math.abs(t.y - point.y) < 14)) continue;
                            const route = { ticks: field.ticksAt(point) }, remainingFlight = distance(point, home) / weaponTiming(threat.target).bulletSpeed;
                            const deadline = threat.fatalTicks - remainingFlight;
                            if (route.ticks > deadline + 4) continue;
                            // A shot available before shield expiry/fatal fire
                            // is preferable to sacrificing a useful defender.
                            const ownShot = Object.keys(DIRECTIONS).map(direction => shotAt(room, physicalV6(bot), direction, threat.target))
                                .find(value => value && !value.breach);
                            const ownTiming = weaponTiming(bot), killTicks = ownShot
                                ? Math.max(ownTiming.ready + ownShot.distance / ownTiming.bulletSpeed, (threat.target.shieldTimer || 0) + 1)
                                    + Math.max(0, (threat.target.hp || 1) - 1) * ownTiming.cooldown
                                : Infinity;
                            if (!task?.screen && killTicks + 4 < threat.fatalTicks) continue;
                            // Preserve an attacking force unless losing the
                            // base is imminent. Existing defenders are cheaper.
                            const roleCost = task?.screen ? -18 : task?.kind === 'defend' ? -10 : 18;
                            if (used.size >= Math.max(1, bots.length - 1) && threat.fatalTicks > 40) continue;
                            const score = route.ticks + roleCost - Math.min(8, bot.hp || 1) - (bot.shieldTimer > route.ticks ? 8 : 0);
                            if (!winner || score < winner.score) winner = { bot, point, route, deadline, score };
                        }
                    }
                    if (winner) {
                        setTaskV6(this, winner.bot, { kind: 'guard', target: winner.point, screen: true,
                            screenThreatId: threat.target.id, timingScreen: true,
                            fatalTicks: threat.fatalTicks, interceptTicks: winner.route.ticks,
                            interceptDeadline: winner.deadline });
                        used.add(winner.bot.id); points.push(winner.point);
                    }
                }
            }
        }
    };
}
