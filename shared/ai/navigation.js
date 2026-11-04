import { canMoveTo } from '../physics.js';
import { checkRectOverlap } from '../utils.js';
import { DIRECTIONS, shotAt, distance, liveTanks } from './geometry.js';

const SIDE = 25; // top-left positions of a 16px tank on the 8px terrain grid
const key = (x, y) => y * SIDE + x;
const point = id => ({ x: (id % SIDE) * 8, y: Math.floor(id / SIDE) * 8 });

class Heap {
    items = [];
    push(id, cost) {
        const item = { id, cost };
        let i = this.items.length;
        this.items.push(item);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.items[parent].cost <= cost) break;
            this.items[i] = this.items[parent];
            i = parent;
        }
        this.items[i] = item;
    }
    pop() {
        const result = this.items[0];
        const last = this.items.pop();
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

export function terrainCost(room, bot, p) {
    if (room.teamManager.getAllBases().some(b => !b.isDead && checkRectOverlap({ ...p, width: 16, height: 16 }, b))) return Infinity;
    if (canMoveTo(p.x, p.y, room.map)) return 1;
    let cost = 1;
    for (let r = p.y / 8; r < p.y / 8 + 2; r++) {
        for (let c = p.x / 8; c < p.x / 8 + 2; c++) {
            const cell = room.map[r]?.[c];
            if (!cell || cell.type === 4) return Infinity;
            if ((cell.type === 1 || cell.type === 2) && cell.mask) {
                if (room.teamManager.isInBaseZone(bot.team, r, c)) return Infinity;
                if (cell.type === 2 && (bot.level || 1) < 4) return Infinity;
                cost += cell.type === 2 ? 12 : (cell.isBaseWall && room.settings.vibraniumBase ? 25 : 5);
            }
        }
    }
    return cost;
}

export function findPath(room, bot, task) {
    if (!room.map.length || !task) return [];
    const occupied = liveTanks(room).filter(t => t.id !== bot.id);
    const costs = new Float64Array(SIDE * SIDE);
    const goals = new Map();
    for (let id = 0; id < costs.length; id++) {
        const p = point(id);
        costs[id] = terrainCost(room, bot, p);
        if (!Number.isFinite(costs[id])) continue;
        if (occupied.some(t => Math.abs(t.x - p.x) < 14 && Math.abs(t.y - p.y) < 14)) costs[id] += 12;
        if (task.kind === 'bonus' || task.kind === 'guard') {
            if (distance(p, task.target) <= (task.kind === 'bonus' ? 8 : 4)) goals.set(id, 0);
        } else {
            for (const direction of Object.keys(DIRECTIONS)) {
                const shot = shotAt(room, { ...bot, ...p }, direction, task.target);
                if (shot && shot.distance <= 104) {
                    goals.set(id, shot.distance / 48 + (shot.breach ? 4 : 0));
                    break;
                }
            }
        }
    }
    if (!goals.size) return [];
    const start = key(Math.max(0, Math.min(24, Math.round(bot.x / 8))), Math.max(0, Math.min(24, Math.round(bot.y / 8))));
    const best = new Float64Array(costs.length).fill(Infinity);
    const previous = new Int32Array(costs.length).fill(-1);
    const queue = new Heap();
    best[start] = 0;
    queue.push(start, 0);
    let finish = -1, finishCost = Infinity;
    while (queue.items.length) {
        const { id, cost } = queue.pop();
        if (cost !== best[id]) continue;
        if (cost >= finishCost) break;
        if (goals.has(id) && cost + goals.get(id) < finishCost) {
            finish = id;
            finishCost = cost + goals.get(id);
        }
        const x = id % SIDE, y = Math.floor(id / SIDE);
        for (const [dx, dy] of Object.values(DIRECTIONS)) {
            if (x + dx < 0 || x + dx >= SIDE || y + dy < 0 || y + dy >= SIDE) continue;
            const next = key(x + dx, y + dy);
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
    for (let id = finish; id !== -1; id = previous[id]) path.push(point(id));
    return path.reverse();
}
