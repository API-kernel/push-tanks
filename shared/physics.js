import { TILE_SIZE } from './config.js';

function checkRectIntersection(r1, r2) {
    return (
        r1.x < r2.x + r2.w &&
        r1.x + r1.w > r2.x &&
        r1.y < r2.y + r2.h &&
        r1.y + r1.h > r2.y
    );
}

export function canMoveTo(newX, newY, map) {
    if (!map) return true;

    // Танк 14x14 (с отступами)
    const tankRect = { x: newX + 1, y: newY + 1, w: 14, h: 14 };

    // Индексы сетки (8px)
    const startCol = Math.floor(tankRect.x / TILE_SIZE);
    const endCol   = Math.floor((tankRect.x + tankRect.w) / TILE_SIZE);
    const startRow = Math.floor(tankRect.y / TILE_SIZE);
    const endRow   = Math.floor((tankRect.y + tankRect.h) / TILE_SIZE);

    const SUB_SIZE = 4; // Микро-блок

    for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
            if (row < 0 || row >= map.length || col < 0 || col >= map[0].length) continue;

            const cell = map[row][col];
            if (cell === 0 || cell === 3 || cell === 5) continue;

            const blockX = col * TILE_SIZE;
            const blockY = row * TILE_SIZE;

            if (typeof cell === 'object') {
                if (cell.mask === 0) continue;
                // Проверяем 4 микро-блока (2x2)
                for (let r = 0; r < 2; r++) {
                    for (let c = 0; c < 2; c++) {
                        if ((cell.mask & (1 << (r * 2 + c))) !== 0) {
                            const subRect = { 
                                x: blockX + c * SUB_SIZE, 
                                y: blockY + r * SUB_SIZE, 
                                w: SUB_SIZE, h: SUB_SIZE 
                            };
                            if (checkRectIntersection(tankRect, subRect)) return false;
                        }
                    }
                }
            } else if (cell === 4) {
                // Вода 8x8
                const waterRect = { x: blockX, y: blockY, w: 8, h: 8 };
                if (checkRectIntersection(tankRect, waterRect)) return false;
            }
        }
    }
    return true;
}