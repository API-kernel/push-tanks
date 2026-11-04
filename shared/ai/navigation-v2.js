import { checkRectOverlap } from '../utils.js';
import { DIRECTIONS, distance, firstWall, liveTanks, shotAt } from './geometry.js';
import { createBullet } from '../bullet.js';

const STEP = 8, SIDE = 25;
const point = id => ({ x: (id % SIDE) * STEP, y: Math.floor(id / SIDE) * STEP });

class Heap {
    items = [];
    push(id, cost) {
        const item = { id, cost };
        let i = this.items.length;
        this.items.push(item);
        while (i) {
            const parent = (i - 1) >> 1;
            if (this.items[parent].cost <= cost) break;
            this.items[i] = this.items[parent];
            i = parent;
        }
        this.items[i] = item;
    }
    pop() {
        const result = this.items[0], last = this.items.pop();
        if (!this.items.length) return result;
        let i = 0;
        while (i * 2 + 1 < this.items.length) {
            let child = i * 2 + 1;
            if (child + 1 < this.items.length && this.items[child + 1].cost < this.items[child].cost) child++;
            if (last.cost <= this.items[child].cost) break;
            this.items[i] = this.items[child];
            i = child;
        }
        this.items[i] = last;
        return result;
    }
}

// Match the 14px terrain hull and the 4px wall masks used by physics. Destroyed
// cells are numeric zero; a partly cleared footprint must still be breachable.
export function terrainCost(room, bot, p) {
    if (p.x < 0 || p.y < 0 || p.x > 192 || p.y > 192) return Infinity;
    const hull = { x: p.x + 1, y: p.y + 1, width: 14, height: 14 };
    const body = { x: p.x + 2, y: p.y + 2, width: 12, height: 12 };
    if (room.teamManager.getAllBases().some(base => checkRectOverlap(body, base))) return Infinity;
    let cost = 1;
    for (let r = Math.floor(hull.y / 8); r <= Math.floor((hull.y + hull.height) / 8); r++) {
        for (let c = Math.floor(hull.x / 8); c <= Math.floor((hull.x + hull.width) / 8); c++) {
            if (!room.map[r] || c < 0 || c >= room.map[r].length) return Infinity;
            const cell = room.map[r][c];
            if (!cell || cell.type === 0 || cell.type === 3 || cell.type === 5) continue;
            if (cell.type === 4) {
                if (checkRectOverlap(hull, { x: c * 8, y: r * 8, width: 8, height: 8 })) return Infinity;
                continue;
            }
            if (cell.type !== 1 && cell.type !== 2) continue;
            let blocks = 0;
            for (let bit = 0; bit < 4; bit++) {
                if ((cell.mask & (1 << bit)) && checkRectOverlap(hull, {
                    x: c * 8 + bit % 2 * 4, y: r * 8 + Math.floor(bit / 2) * 4, width: 4, height: 4
                })) blocks++;
            }
            if (!blocks) continue;
            if (room.teamManager.isInBaseZone(bot.team, r, c) || (cell.type === 2 && (bot.level || 1) < 4)) return Infinity;
            cost += blocks * (cell.isBaseWall && room.settings.vibraniumBase ? 8 : cell.type === 2 ? 3 : 1.5);
        }
    }
    return cost;
}

function segmentCost(room, bot, a, b) {
    const length = distance(a, b);
    if (a.x !== b.x && a.y !== b.y) return Infinity;
    const samples = Math.max(1, Math.ceil(length / 2));
    let worst = 1;
    for (let i = 1; i <= samples; i++) {
        const cost = terrainCost(room, bot, { x: a.x + (b.x - a.x) * i / samples, y: a.y + (b.y - a.y) * i / samples });
        if (!Number.isFinite(cost)) return Infinity;
        worst = Math.max(worst, cost);
    }
    return length / STEP * worst;
}

function goalCost(room, bot, task, p) {
    if (task.kind === 'bonus' || task.kind === 'guard') return distance(p, task.target) <= (task.kind === 'bonus' ? 8 : 4) ? 0 : Infinity;
    let result = Infinity;
    for (const direction of Object.keys(DIRECTIONS)) {
        const shot = shotAt(room, { ...bot, ...p }, direction, task.target);
        if (!shot || shot.distance > (task.maxShotDistance ?? (task.kind === 'attack' && !shot.breach ? 208 : 104))) continue;
        let penalty = 0;
        if (shot.breach) {
            const wall = firstWall(room, createBullet({ ...bot, ...p, direction }, bot.bulletSpeed), shot.distance);
            penalty = wall?.cell.isBaseWall && room.settings.vibraniumBase ? 35 : 7;
        }
        const rangeCost = task.preferredRange === undefined ? shot.distance / 64 : Math.abs(shot.distance - task.preferredRange) / 32;
        const approachCost = task.approach ? distance(p, task.approach) / 24 : 0;
        result = Math.min(result, rangeCost + approachCost + penalty);
    }
    return result;
}

// Connect the real, potentially fractional position to nearby graph nodes with
// tested cardinal segments. Rounding a tank into a sealed node can invent a
// route, or strand it on the wrong side of a wall after smart alignment.
export function findPath(room, bot, task, { avoid = [] } = {}) {
    if (!room.map.length || !task) return [];
    const count = SIDE * SIDE, costs = new Float64Array(count), goals = new Float64Array(count);
    const occupied = liveTanks(room).filter(tank => tank.id !== bot.id);
    for (let id = 0; id < count; id++) {
        const p = point(id);
        costs[id] = terrainCost(room, bot, p);
        goals[id] = Infinity;
        if (!Number.isFinite(costs[id])) continue;
        goals[id] = goalCost(room, bot, task, p);
        for (const tank of occupied) {
            if (Math.abs(tank.x - p.x) < 14 && Math.abs(tank.y - p.y) < 14) costs[id] += tank.team === bot.team ? 15 : 8;
        }
        for (const blocked of avoid) if (distance(p, blocked) < 12) costs[id] += 18;
    }
    const best = new Float64Array(count).fill(Infinity), previous = new Int32Array(count).fill(-1);
    const connectors = new Map(), queue = new Heap();
    for (let y = Math.max(0, Math.floor(bot.y / 8) - 1); y <= Math.min(24, Math.ceil(bot.y / 8) + 1); y++) {
        for (let x = Math.max(0, Math.floor(bot.x / 8) - 1); x <= Math.min(24, Math.ceil(bot.x / 8) + 1); x++) {
            const id = y * SIDE + x, p = point(id);
            if (!Number.isFinite(costs[id])) continue;
            for (const bend of [{ x: p.x, y: bot.y }, { x: bot.x, y: p.y }]) {
                const cost = segmentCost(room, bot, bot, bend) + segmentCost(room, bot, bend, p) + Math.max(0, costs[id] - terrainCost(room, bot, p));
                if (cost >= best[id]) continue;
                best[id] = cost;
                connectors.set(id, [bend, p].filter((v, index, points) => distance(index ? points[index - 1] : bot, v) > .01));
                queue.push(id, cost);
            }
        }
    }
    let finish = -1, finishCost = Infinity;
    while (queue.items.length) {
        const { id, cost } = queue.pop();
        if (cost !== best[id]) continue;
        if (cost >= finishCost) break;
        if (cost + goals[id] < finishCost) {
            finish = id;
            finishCost = cost + goals[id];
        }
        const x = id % SIDE, y = Math.floor(id / SIDE);
        for (const [dx, dy] of Object.values(DIRECTIONS)) {
            if (x + dx < 0 || x + dx >= SIDE || y + dy < 0 || y + dy >= SIDE) continue;
            const next = (y + dy) * SIDE + x + dx;
            const score = cost + costs[next];
            if (score < best[next]) {
                best[next] = score;
                previous[next] = id;
                queue.push(next, score);
            }
        }
    }
    if (finish < 0) return [];
    const path = [];
    let start = finish;
    for (let id = finish; id !== -1; id = previous[id]) { path.push(point(id)); start = id; }
    path.reverse();
    path.shift();
    const result = [...(connectors.get(start) || []), ...path];
    return result.length ? result : [{ x: bot.x, y: bot.y }];
}
