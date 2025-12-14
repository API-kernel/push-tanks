import { BLOCK_FULL, BASE_WALLS, TEAMS_CONFIG, TILE_SIZE } from './config.js';

export function createLevel(rawMapData, basesEnabled) {
    if (!rawMapData) return [];

    const map = JSON.parse(JSON.stringify(rawMapData));

    if (basesEnabled) {
        TEAMS_CONFIG.forEach(team => {
            let startCol = 10;
            let endCol = 15;
            let startRow, endRow;

            if (team.direction === 'UP') { 
                startRow = 22; 
                endRow = 25;
            } else {
                startRow = 0;
                endRow = 3;
            }

            for (let r = startRow; r <= endRow; r++) {
                for (let c = startCol; c <= endCol; c++) {
                    if (map[r] && map[r][c] !== undefined) {
                        map[r][c] = 0; 
                    }
                }
            }
        });
    }

    // 2. Преобразование в объекты
    for (let r = 0; r < map.length; r++) {
        for (let c = 0; c < map[r].length; c++) {
            const cell = map[r][c];
            if (cell === 1 || cell === 2) {
                map[r][c] = { type: cell, mask: BLOCK_FULL }; // 0xF
            }
        }
    }

    if (basesEnabled) {
        TEAMS_CONFIG.forEach(team => {
            const walls = BASE_WALLS[team.id];
            if (walls) {
                walls.forEach(w => {
                    if (map[w.r] && map[w.r][w.c] !== undefined) {
                        map[w.r][w.c] = { type: 1, mask: BLOCK_FULL };
                    }
                });
            }
        });

        // АВТО-УКРЕПЛЕНИЕ (Line of Sight)
        const checkCols = [12, 13]; // Центральные колонки

        let hasConcreteBlocker = false;

        // Сканируем пространство МЕЖДУ базами (исключая сами базы)
        // Ряды от 4 до 21 (примерно)
        for (let r = 4; r <= 21; r++) {
            // Проверяем ширину базы
            let rowHasConcrete = false;
            for (const c of checkCols) {
                const cell = map[r][c];
                if (typeof cell === 'object' && cell.type === 2 && cell.mask > 0) {
                    rowHasConcrete = true;
                    break; 
                }
            }
            if (rowHasConcrete) {
                hasConcreteBlocker = true;
                break;
            }
        }

        if (!hasConcreteBlocker) {
            // Укрепляем "крышу" Зеленых (перед лицом врага)
            if (map[23][12]) map[23][12].type = 2; // Бетон
            if (map[23][13]) map[23][13].type = 2;

            // Укрепляем "пол" Красных (перед лицом врага)
            if (map[2][12]) map[2][12].type = 2;
            if (map[2][13]) map[2][13].type = 2;
        }
    }

    return map;
}

export function destroyBlockAt(map, x, y) {
    if (!map) return;
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    // Танк занимает 2x2 тайла (16x16 / 8x8)
    const col2 = col + 1;
    const row2 = row + 1;

    const clear = (r, c) => {
        if (r >= 0 && r < map.length && c >= 0 && c < map[0].length) {
            const cell = map[r][c];
            //object: Это Стена (Кирпич 1, Бетон 2) — у них есть маска.
            if (typeof cell === 'object' || cell === 4) map[r][c] = 0;
        }
    };
    clear(row, col); clear(row, col2); clear(row2, col); clear(row2, col2);
}