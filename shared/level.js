import { TILE_SIZE, BASE_WALLS, TEAMS_CONFIG } from '../shared/config.js';

const rawLevel1 = [
    [0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,0,0,1,1,1,0,0,1,0],
    [0,1,0,1,0,0,1,0,1,0,0,1,0],
    [0,1,1,1,0,0,1,1,1,0,0,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,0,2,2,2,2,2,2,0,1,1],
    [0,1,1,0,2,4,4,4,2,2,0,1,1],
    [0,0,0,0,2,4,4,4,2,2,0,0,0],
    [0,3,3,3,0,0,0,0,0,0,3,3,3],
    [0,3,3,3,0,0,0,0,0,0,3,3,3],
    [0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,0,0,1,1,1,0,0,1,0],
    [0,1,1,1,0,0,0,1,1,0,0,1,0]
];

export let level1 = [];

export function initLevel() {
    // 1. Создаем карту
    level1 = rawLevel1.map(row => row.map(cell => {
        if (cell === 1 || cell === 2) {
            return { type: cell, mask: 0xFFFF }; 
        }
        return cell;
    }));

    // 2. Строим стены баз
    TEAMS_CONFIG.forEach(team => {
        const walls = BASE_WALLS[team.id];
        if (walls) {
            walls.forEach(w => {
                if (level1[w.r] && level1[w.r][w.c] !== undefined) {
                    level1[w.r][w.c] = { type: 1, mask: w.mask };
                }
            });
        }
    });
}

export function destroyBlockAt(x, y) {
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    const col2 = Math.floor((x + 15) / TILE_SIZE);
    const row2 = Math.floor((y + 15) / TILE_SIZE);

    const clearCell = (r, c) => {
        if (r >= 0 && r < level1.length && c >= 0 && c < level1[0].length) {
            const cell = level1[r][c];
            if (typeof cell === 'object' || cell === 3 || cell === 4) {
                level1[r][c] = 0;
            }
        }
    };

    clearCell(row, col);
    clearCell(row, col2);
    clearCell(row2, col);
    clearCell(row2, col2);
}