import { TILE_SIZE, BASE_WALLS, TEAMS_CONFIG } from './config.js';

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

export function createLevel() {
    const map = JSON.parse(JSON.stringify(rawLevel1));

    for (let r = 0; r < map.length; r++) {
        for (let c = 0; c < map[r].length; c++) {
            const cell = map[r][c];
            if (cell === 1 || cell === 2) {
                map[r][c] = { type: cell, mask: 0xFFFF };
            }
        }
    }

    TEAMS_CONFIG.forEach(team => {
        const walls = BASE_WALLS[team.id];
        if (walls) {
            walls.forEach(w => {
                if (map[w.r] && map[w.r][w.c] !== undefined) {
                    map[w.r][w.c] = { type: 1, mask: w.mask };
                }
            });
        }
    });

    return map;
}

// Принимает карту аргументом!
export function destroyBlockAt(map, x, y) {
    if (!map) return;
    
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    const col2 = Math.floor((x + 15) / TILE_SIZE);
    const row2 = Math.floor((y + 15) / TILE_SIZE);

    const clearCell = (r, c) => {
        if (r >= 0 && r < map.length && c >= 0 && c < map[0].length) {
            const cell = map[r][c];
            if (typeof cell === 'object' || cell === 3 || cell === 4) {
                map[r][c] = 0;
            }
        }
    };

    clearCell(row, col);
    clearCell(row, col2);
    clearCell(row2, col);
    clearCell(row2, col2);
}