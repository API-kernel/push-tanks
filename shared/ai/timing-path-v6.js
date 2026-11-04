import { TANK_STATS } from '../config.js';
import { checkRectOverlap } from '../utils.js';
import { DIRECTIONS, distance, liveTanks } from './geometry.js';

const SIDE = 25, STEP = 8, COUNT = SIDE * SIDE, STEPS = Object.values(DIRECTIONS);
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

function footprint(room, tank, p, allowBreach, bases = room.teamManager.getAllBases()) {
    if (p.x < 0 || p.y < 0 || p.x > 192 || p.y > 192) return null;
    const hull = { x: p.x + 1, y: p.y + 1, width: 14, height: 14 };
    if (bases.some(base => checkRectOverlap(hull, base))) return null;
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

function clearConnector(room, tank, a, b, bases) {
    const length = distance(a, b);
    for (let step = 0; step <= Math.ceil(length); step++) {
        const fraction = length ? Math.min(1, step / length) : 0;
        const p = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
        if (!footprint(room, tank, p, false, bases)) return false;
    }
    return true;
}

// One bounded distance field serves many local candidate points. The estimate
// includes real detours and expected demolition time, not Manhattan distance.
// Clearing cover is an estimate: 16px blast width, 4/8px depth, independent 10%
// vibranium damage chance. It does not sample or consume the game's RNG.
function tickTerrain(room, tank, allowBreach) {
    const footprints = Array(COUNT), blockKeys = Array(COUNT), bases = room.teamManager.getAllBases();
    for (let id = 0; id < COUNT; id++) {
        footprints[id] = footprint(room, tank, point(id), allowBreach, bases);
        if (footprints[id]?.length) blockKeys[id] = new Set(footprints[id].map(block => block.key));
    }
    return { footprints, blockKeys, bases, edgeShots: new Float64Array(COUNT * 4).fill(-1) };
}

export function createTickField(room, tank, { allowBreach = false, maxExpansions = COUNT * 2, crowd = true, _terrain } = {}) {
    const timing = weaponTiming(tank), terrain = _terrain || tickTerrain(room, tank, allowBreach);
    const { footprints, blockKeys, bases, edgeShots } = terrain, occupancy = new Float64Array(COUNT);
    const occupied = crowd ? liveTanks(room).filter(t => t.id !== tank.id) : [];
    if (occupied.length) for (let id = 0; id < COUNT; id++) {
        if (!footprints[id]) continue;
        const p = point(id);
        for (const other of occupied) {
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
                if (!clearConnector(room, tank, tank, bend, bases) || !clearConnector(room, tank, bend, p, bases)) continue;
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
        const priorBlocks = blockKeys[id];
        for (let direction = 0; direction < STEPS.length; direction++) {
            const [dx, dy] = STEPS[direction];
            const x = id % SIDE + dx, y = Math.floor(id / SIDE) + dy;
            if (x < 0 || y < 0 || x >= SIDE || y >= SIDE) continue;
            const next = y * SIDE + x, blocks = footprints[next];
            if (!blocks) continue;
            const edge = id * 4 + direction;
            let shots = edgeShots[edge];
            // Cover and blast depth are invariant within this terrain snapshot.
            // Cache each directed edge, preserving mixed vibranium plane order.
            if (shots < 0) {
                shots = 0;
                if (blocks.length) {
                    const planes = new Map();
                    for (const block of blocks) {
                        if (priorBlocks?.has(block.key)) continue;
                        const axis = dx ? block.x : block.y;
                        planes.set(axis, Math.max(planes.get(axis) || 0, block.vibranium ? 10 : 1));
                    }
                    const ordered = [...planes.values()];
                    for (let i = 0; i < ordered.length; i += timing.depth / 4) {
                        shots += timing.depth === 4 ? ordered[i] : Math.max(ordered[i], ordered[i + 1] ?? -Infinity);
                    }
                }
                edgeShots[edge] = shots;
            }
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
    const nodeAt = p => p.x < 0 || p.y < 0 || p.x > 192 || p.y > 192 || p.x % 8 || p.y % 8
        ? -1 : p.y / 8 * SIDE + p.x / 8;
    return {
        expansions,
        ticksAt(p) {
            const id = nodeAt(p);
            return id === -1 ? Infinity : best[stateAt(id)];
        },
        at(p) {
            const id = nodeAt(p);
            return id === -1 ? { ticks: Infinity, path: [], breached: false } : route(id);
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
        cache = { tick: controller.tick, map: controller.room.map, fields: new Map(), terrain: new Map(),
            count: 0, requests: new Map([[1, new Set()], [2, new Set()]]) };
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
        // Terrain depends on team protection and level-four penetration only.
        // Clear-only fields can share one snapshot across both teams.
        if (cache.map !== controller.room.map) {
            cache.terrain.clear(); cache.map = controller.room.map;
        }
        const terrainKey = options.allowBreach ? `${tank.team}:${(tank.level || 1) >= 4}` : 'clear';
        if (!cache.terrain.has(terrainKey)) cache.terrain.set(terrainKey, tickTerrain(controller.room, tank, !!options.allowBreach));
        const field = createTickField(controller.room, tank, { ...options, _terrain: cache.terrain.get(terrainKey) });
        cache.fields.set(key, field);
        return field;
    }, get count() { return cache.count; }, get teamCount() { return requests.size; }, quota };
}

export const clearPointV6 = (room, tank, p) => footprint(room, tank, p, false) !== null;
