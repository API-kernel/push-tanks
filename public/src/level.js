import { SPRITES, TILE_SIZE } from './sprites.js';
import { TEAMS_CONFIG, BASE_WALLS } from '../shared/config.js';

// Карту не меняем, она та же
const rawLevel1 = [
    [0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,0,0,1,1,1,0,0],
    [0,1,0,1,0,0,1,0,1,0,0],
    [0,1,1,1,0,0,1,1,1,0,0],
    [0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,0,2,2,2,2,2,2,0],
    [0,1,1,0,2,4,4,4,2,2,0],
    [0,0,0,0,2,4,4,4,2,2,0],
    [0,3,3,3,0,0,0,0,0,0,3],
    [0,3,3,3,0,0,0,0,0,0,3],
    [0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,0,0,1,1,1,0,0],
    [0,1,1,1,0,0,0,1,1,0,0]
];

export let level1 = [];

export function initLevel() {
    level1 = rawLevel1.map(row => row.map(cell => {
        if (cell === 1 || cell === 2) {
            return { type: cell, mask: 0xFFFF }; 
        }
        return cell;
    }));

    // Применяем стены баз из конфига
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

// Добавь аргумент `gameTime` (мы будем передавать Date.now())
// Основной слой (Под танками)
export function drawMapLayers(ctx, spritesImage, levelMap, gameTime) {
    if (!levelMap) return;
    const waterFrame = Math.floor(gameTime / 1000) % 2;

    for (let row = 0; row < levelMap.length; row++) {
        for (let col = 0; col < levelMap[row].length; col++) {
            const block = levelMap[row][col];
            
            // Если это ЛЕС (3) - пропускаем! Рисуем потом.
            if (block === 3) continue;

            if (typeof block === 'object') {
                // ... (код отрисовки стен тот же) ...
                const baseSprite = SPRITES.blocks[block.type]; 
                if (!baseSprite) continue;
                const [bx, by] = baseSprite;
                const subSize = 4;
                for (let r = 0; r < 4; r++) {
                    for (let c = 0; c < 4; c++) {
                        if ((block.mask & (1 << (r * 4 + c))) !== 0) {
                            ctx.drawImage(spritesImage, bx + c * subSize, by + r * subSize, subSize, subSize, col * 16 + c * subSize, row * 16 + r * subSize, subSize, subSize);
                        }
                    }
                }
            } else {
                if (block === 4) { // Вода
                    const frames = SPRITES.blocks[4]; 
                    const [sx, sy, sw, sh] = frames[waterFrame];
                    ctx.drawImage(spritesImage, sx, sy, sw, sh, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                } 
                else if (block !== 0) { // Лед (5) и прочее
                    const spriteCoords = SPRITES.blocks[block];
                    if (spriteCoords) {
                        const [sx, sy, sw, sh] = spriteCoords;
                        ctx.drawImage(spritesImage, sx, sy, sw, sh, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                    }
                }
            }
        }
    }
}

// Функция для уничтожения блока (вызывается при спавне танка)
export function destroyBlockAt(x, y) {
    // Переводим пиксели в индексы сетки
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    const col2 = Math.floor((x + 15) / TILE_SIZE); // Проверяем и соседний блок (танк 16px)
    const row2 = Math.floor((y + 15) / TILE_SIZE);

    const clearCell = (r, c) => {
        if (r >= 0 && r < level1.length && c >= 0 && c < level1[0].length) {
            // Если там стена (1, 2) или лес (3) или вода (4) - удаляем
            // Оставляем только лед (5) или пустоту (0)
            const cell = level1[r][c];
            // Удаляем объекты и воду/лес
            if (typeof cell === 'object' || cell === 3 || cell === 4) {
                level1[r][c] = 0;
            }
        }
    };

    // Чистим все 4 тайла, которые может занимать танк
    clearCell(row, col);
    clearCell(row, col2);
    clearCell(row2, col);
    clearCell(row2, col2);
}

// Верхний слой (Над танками)
export function drawForest(ctx, spritesImage, levelMap) {
    if (!levelMap) return;
    const forestSprite = SPRITES.blocks[3]; // Лес

    for (let row = 0; row < levelMap.length; row++) {
        for (let col = 0; col < levelMap[row].length; col++) {
            const block = levelMap[row][col];
            if (block === 3) { // Рисуем только лес
                const [sx, sy, sw, sh] = forestSprite;
                ctx.drawImage(spritesImage, sx, sy, sw, sh, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }
    }
}