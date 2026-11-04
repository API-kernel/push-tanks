import { TANK_STATS } from '../config.js';
import { checkRectOverlap } from '../utils.js';
import { DIRECTIONS, distance, liveTanks } from './geometry.js';

const SIDE = 25, STEP = 8, COUNT = SIDE * SIDE;
const point = id => ({ x: id % SIDE * STEP, y: Math.floor(id / SIDE) * STEP });
const speed = tank => Math.max(.1, tank.speed || 35 / 60);
export function weaponTiming(tank) {
    const stats = TANK_STATS.player.levels[tank.level || 1];
    return { cooldown: tank.bulletCooldownMax ?? stats.cooldown,
        ready: Math.max(0, tank.bulletTimer ?? tank.bulletCooldown ?? 0),
        bulletSpeed: tank.bulletSpeed ?? stats.bulletSpeed,
        depth: (tank.level || 1) >= 4 ? 8 : 4 };
}

// Explicit public fields: evaluating a player never reads its queued inputs.
export function physicalV6(tank) {
    const copy = {};
    for (const key of ['id', 'team', 'x', 'y', 'width', 'height', 'direction', 'speed', 'hp',
        'baseHp', 'level', 'shieldTimer', 'isMoving', 'bulletSpeed', 'bulletCooldownMax',
        'bulletTimer', 'bulletCooldown']) copy[key] = tank[key];
    return copy;
}
export function setTaskV6(controller, bot, task) {
    controller.tasks.set(bot.id, task);
    controller.strategicTasks?.set(bot.id, task);
}

class Heap {
    items = [];
    push(id, cost) {
        let index = this.items.length;
        this.items.push({ id, cost });
        while (index) {
            const parent = (index - 1) >> 1;
            if (this.items[parent].cost <= cost) break;
            this.items[index] = this.items[parent]; index = parent;
        }
        this.items[index] = { id, cost };
    }
    pop() {
        const first = this.items[0], last = this.items.pop();
        if (!this.items.length) return first;
        let index = 0;
        while (index * 2 + 1 < this.items.length) {
            let child = index * 2 + 1;
            if (child + 1 < this.items.length && this.items[child + 1].cost < this.items[child].cost) child++;
            if (last.cost <= this.items[child].cost) break;
            this.items[index] = this.items[child]; index = child;
        }
        this.items[index] = last;
        return first;
    }
}

function footprint(room, tank, p, allowBreach) {
    if (p.x < 0 || p.y < 0 || p.x > 192 || p.y > 192) return null;
    const hull = { x: p.x + 1, y: p.y + 1, width: 14, height: 14 };
    if (room.teamManager.getAllBases().some(base => checkRectOverlap(hull, base))) return null;
    const blocks = [];
    for (let r = Math.floor(hull.y / 8); r <= Math.floor((hull.y + 13.999) / 8); r++) {
        for (let c = Math.floor(hull.x / 8); c <= Math.floor((hull.x + 13.999) / 8); c++) {
            const cell = room.map[r]?.[c];
            if (cell === undefined) return null;
            if (cell?.type === 4 && checkRectOverlap(hull, { x: c * 8, y: r * 8, width: 8, height: 8 })) return null;
            if (![1, 2].includes(cell?.type) || !cell.mask) continue;
            for (let bit = 0; bit < 4; bit++) {
                const block = { x: c * 8 + bit % 2 * 4, y: r * 8 + Math.floor(bit / 2) * 4, width: 4, height: 4 };
                if (!(cell.mask & 1 << bit) || !checkRectOverlap(hull, block)) continue;
                if (!allowBreach || room.teamManager.isInBaseZone(tank.team, r, c)
                    || (cell.type === 2 && (tank.level || 1) < 4)) return null;
                blocks.push({ ...block, key: `${r}:${c}:${bit}`, vibranium: cell.isBaseWall && room.settings.vibraniumBase });
            }
        }
    }
    return blocks;
}

function clearConnector(room, tank, a, b) {
    const length = distance(a, b);
    for (let step = 0; step <= Math.ceil(length); step++) {
        const fraction = length ? Math.min(1, step / length) : 0;
        const p = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
        if (!footprint(room, tank, p, false)) return false;
    }
    return true;
}

// One bounded distance field serves many local candidate points. The estimate
// includes real detours and expected demolition time, not Manhattan distance.
// Clearing cover is an estimate: 16px blast width, 4/8px depth, independent 10%
// vibranium damage chance. It does not sample or consume the game's RNG.
export function createTickField(room, tank, { allowBreach = false, maxExpansions = COUNT * 2, crowd = true } = {}) {
    const timing = weaponTiming(tank), footprints = Array(COUNT), occupancy = new Float64Array(COUNT);
    const occupied = crowd ? liveTanks(room).filter(t => t.id !== tank.id) : [];
    for (let id = 0; id < COUNT; id++) {
        const p = point(id);
        footprints[id] = footprint(room, tank, p, allowBreach);
        if (footprints[id]) for (const other of occupied) {
            if (Math.abs(other.x - p.x) < 14 && Math.abs(other.y - p.y) < 14) occupancy[id] += other.team === tank.team ? 20 : 10;
        }
    }
    // State 0 has not fired to clear terrain; state 1 has. Initial cooldown is
    // paid once, at first contact, rather than once for each wall cell.
    const best = new Float64Array(COUNT * 2).fill(Infinity);
    const previous = new Int32Array(COUNT * 2).fill(-1), roots = new Map();
    const heap = new Heap();
    for (let y = Math.max(0, Math.floor(tank.y / 8) - 1); y <= Math.min(24, Math.ceil(tank.y / 8) + 1); y++) {
        for (let x = Math.max(0, Math.floor(tank.x / 8) - 1); x <= Math.min(24, Math.ceil(tank.x / 8) + 1); x++) {
            const id = y * SIDE + x, p = point(id);
            if (!footprints[id] || footprints[id].length) continue;
            for (const bend of [{ x: p.x, y: tank.y }, { x: tank.x, y: p.y }]) {
                if (!clearConnector(room, tank, tank, bend) || !clearConnector(room, tank, bend, p)) continue;
                const cost = distance(tank, p) / speed(tank) + occupancy[id];
                if (cost >= best[id]) continue;
                best[id] = cost; roots.set(id, [bend, p].filter((v, i, values) => distance(i ? values[i - 1] : tank, v) > .01));
                heap.push(id, cost);
            }
        }
    }
    let expansions = 0;
    while (heap.items.length && expansions < maxExpansions) {
        const { id: state, cost } = heap.pop();
        if (cost !== best[state]) continue;
        expansions++;
        const id = state % COUNT, hasFired = state >= COUNT;
        const priorBlocks = new Set(footprints[id].map(block => block.key));
        for (const [dx, dy] of Object.values(DIRECTIONS)) {
            const x = id % SIDE + dx, y = Math.floor(id / SIDE) + dy;
            if (x < 0 || y < 0 || x >= SIDE || y >= SIDE) continue;
            const next = y * SIDE + x, blocks = footprints[next];
            if (!blocks) continue;
            const entering = blocks.filter(block => !priorBlocks.has(block.key));
            const planes = new Map();
            for (const block of entering) {
                const axis = dx ? block.x : block.y;
                planes.set(axis, Math.max(planes.get(axis) || 0, block.vibranium ? 10 : 1));
            }
            // A level-four blast clears two 4px depth planes in one shot.
            const ordered = [...planes.values()];
            let shots = 0;
            for (let i = 0; i < ordered.length; i += timing.depth / 4) shots += Math.max(...ordered.slice(i, i + timing.depth / 4));
            let breach = 0;
            if (shots) breach = (hasFired ? shots : Math.max(0, shots - 1)) * timing.cooldown
                + (hasFired ? 0 : Math.max(0, timing.ready - cost)) + STEP / Math.max(.1, timing.bulletSpeed);
            const nextState = next + (hasFired || shots ? COUNT : 0);
            const score = cost + STEP / speed(tank) + breach + occupancy[next];
            if (score >= best[nextState]) continue;
            best[nextState] = score; previous[nextState] = state;
            heap.push(nextState, score);
        }
    }
    const stateAt = id => best[id] <= best[id + COUNT] ? id : id + COUNT;
    const route = id => {
        let state = stateAt(id);
        if (!Number.isFinite(best[state])) return { ticks: Infinity, path: [], breached: false };
        const ticks = best[state], breached = state >= COUNT, path = [];
        while (previous[state] !== -1) { path.push(point(state % COUNT)); state = previous[state]; }
        return { ticks, path: [...(roots.get(state) || []), ...path.reverse()], breached };
    };
    return {
        expansions,
        at(p) {
            if (p.x < 0 || p.y < 0 || p.x > 192 || p.y > 192 || p.x % 8 || p.y % 8) return { ticks: Infinity, path: [], breached: false };
            return route(p.y / 8 * SIDE + p.x / 8);
        },
        best(predicate) {
            let winner = null;
            for (let id = 0; id < COUNT; id++) {
                const ticks = best[stateAt(id)];
                if (!Number.isFinite(ticks)) continue;
                const p = point(id), penalty = predicate(p, ticks);
                if (!Number.isFinite(penalty)) continue;
                if (!winner || ticks + penalty < winner.score) winner = { id, score: ticks + penalty };
            }
            return winner ? { ...route(winner.id), point: point(winner.id), score: winner.score } : { ticks: Infinity, path: [] };
        }
    };
}

// Shared only within one strategy refresh. Each planning team owns half the
// request slots, including requests for enemy race/threat fields. Cache hits
// reuse computation but consume the same request slot on either side: iteration
// order cannot grant the second team extra information or exhaust its budget.
export function strategyFields(controller, feature, limit = 8, team) {
    if (team !== 1 && team !== 2) throw new RangeError('strategy field requests require a planning team');
    controller.strategyFieldsV6 ??= new Map();
    let cache = controller.strategyFieldsV6.get(feature);
    if (!cache || cache.tick !== controller.tick) {
        cache = { tick: controller.tick, fields: new Map(), count: 0, requests: new Map([[1, new Set()], [2, new Set()]]) };
        controller.strategyFieldsV6.set(feature, cache);
    }
    const requests = cache.requests.get(team), quota = Math.floor(limit / 2);
    return { get(tank, options = {}) {
        const key = `${tank.id}:${!!options.allowBreach}:${options.crowd !== false}`;
        if (!requests.has(key)) {
            if (requests.size >= quota || (!cache.fields.has(key) && cache.count >= limit)) return null;
            requests.add(key);
        }
        if (cache.fields.has(key)) return cache.fields.get(key);
        cache.count++;
        const field = createTickField(controller.room, tank, options);
        cache.fields.set(key, field);
        return field;
    }, get count() { return cache.count; }, get teamCount() { return requests.size; }, quota };
}

export const clearPointV6 = (room, tank, p) => footprint(room, tank, p, false) !== null;
