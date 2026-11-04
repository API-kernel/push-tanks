import { createBullet } from '../bullet.js';
import { checkRectOverlap } from '../utils.js';

export const DIRECTIONS = {
    UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0]
};
export const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const liveTanks = room => [
    ...room.enemies, ...Object.values(room.players).filter(p => p.team > 0 && !p.isDead && !p.isSpawning)
];

// Use the same 4px micro-blocks as projectile physics, including partially broken walls.
export function wallAt(map, rect) {
    for (let r = Math.floor(rect.y / 8); r <= Math.floor((rect.y + rect.height - .001) / 8); r++) {
        for (let c = Math.floor(rect.x / 8); c <= Math.floor((rect.x + rect.width - .001) / 8); c++) {
            const cell = map[r]?.[c];
            if (!cell || (cell.type !== 1 && cell.type !== 2) || !cell.mask) continue;
            for (let bit = 0; bit < 4; bit++) {
                if ((cell.mask & (1 << bit)) && checkRectOverlap(rect, {
                    x: c * 8 + (bit % 2) * 4, y: r * 8 + Math.floor(bit / 2) * 4, width: 4, height: 4
                })) return { cell, r, c };
            }
        }
    }
    return null;
}

export function firstWall(room, bullet, length) {
    const [dx, dy] = DIRECTIONS[bullet.direction];
    for (let d = 0; d <= length; d += 2) {
        const hit = wallAt(room.map, { ...bullet, x: bullet.x + dx * d, y: bullet.y + dy * d });
        if (hit) return { ...hit, distance: d };
    }
    return null;
}

// No player IDs, nicknames or input packets participate in target scoring.
export function shotAt(room, tank, direction, target) {
    const bullet = createBullet({ ...tank, direction }, tank.bulletSpeed || 2);
    const vertical = direction === 'UP' || direction === 'DOWN';
    const axis = vertical ? 'y' : 'x';
    const cross = vertical ? 'x' : 'y';
    const size = vertical ? 'width' : 'height';
    const depth = vertical ? 'height' : 'width';
    const sign = direction === 'UP' || direction === 'LEFT' ? -1 : 1;
    if (bullet[cross] >= target[cross] + (target[size] || 16) || bullet[cross] + 4 <= target[cross]) return null;
    if (sign * (target[axis] - bullet[axis]) < -(target[depth] || 16)) return null;
    const length = Math.max(0, sign > 0 ? target[axis] - bullet[axis] - 4
        : bullet[axis] - target[axis] - (target[depth] || 16));
    const wall = firstWall(room, bullet, length);
    if (wall && (room.teamManager.isInBaseZone(tank.team, wall.r, wall.c)
        || (wall.cell.type === 2 && (tank.level || 1) < 4))) return null;
    const ownBase = room.teamManager.getAllBases().find(b => b.team === tank.team && !b.isDead);
    if (ownBase) {
        const [dx, dy] = DIRECTIONS[direction];
        for (let d = 0; d <= (wall?.distance ?? length); d += 2) {
            if (checkRectOverlap({ ...bullet, x: bullet.x + dx * d, y: bullet.y + dy * d }, ownBase)) return null;
        }
    }
    return { direction, distance: length, breach: !!wall };
}
