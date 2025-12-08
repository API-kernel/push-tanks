import { TILE_SIZE } from './sprites.js';
import { level1 } from './level.js';

function checkRectIntersection(r1, r2) {
    return (
        r1.x < r2.x + r2.w &&
        r1.x + r1.w > r2.x &&
        r1.y < r2.y + r2.h &&
        r1.y + r1.h > r2.y
    );
}

export function canMoveTo(newX, newY) {
    if (!level1) return true;

    // Танк 14x14
    const tankRect = { x: newX + 1, y: newY + 1, w: TILE_SIZE - 2, h: TILE_SIZE - 2 };

    const startCol = Math.floor(tankRect.x / TILE_SIZE);
    const endCol   = Math.floor((tankRect.x + tankRect.w) / TILE_SIZE);
    const startRow = Math.floor(tankRect.y / TILE_SIZE);
    const endRow   = Math.floor((tankRect.y + tankRect.h) / TILE_SIZE);
    const subSize = 4;

    for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
            if (row < 0 || row >= level1.length || col < 0 || col >= level1[0].length) continue;
            const cell = level1[row][col];
            if (cell === 0 || cell === 3 || cell === 5) continue;
            const blockX = col * TILE_SIZE;
            const blockY = row * TILE_SIZE;

            if (typeof cell === 'object') {
                if (cell.mask === 0) continue;
                for (let r = 0; r < 4; r++) {
                    for (let c = 0; c < 4; c++) {
                        if ((cell.mask & (1 << (r * 4 + c))) !== 0) {
                            const subRect = { x: blockX + c * subSize, y: blockY + r * subSize, w: subSize, h: subSize };
                            if (checkRectIntersection(tankRect, subRect)) return false;
                        }
                    }
                }
            } else if (cell === 4) {
                if (checkRectIntersection(tankRect, { x: blockX, y: blockY, w: 16, h: 16 })) return false;
            }
        }
    }
    return true;
}