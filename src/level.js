import { SPRITES, TILE_SIZE } from './sprites.js';

// Карту не меняем, она та же
const rawLevel1 = [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,0,0,1,1,1,0,0,1,1,1,0],
    [0,1,0,1,0,0,1,0,1,0,0,1,0,1,0],
    [0,1,1,1,0,0,1,1,1,0,0,1,1,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,0,2,2,2,2,2,2,0,1,1,0,0],
    [0,1,1,0,2,4,4,4,2,2,0,1,1,0,0],
    [0,0,0,0,2,4,4,4,2,2,0,0,0,0,0],
    [0,3,3,3,0,0,0,0,0,0,3,3,3,0,0],
    [0,3,3,3,0,0,0,0,0,0,3,3,3,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,0,0,1,1,1,0,0,1,1,1,0],
    [0,1,1,1,0,0,1,1,1,0,0,1,1,1,0]
];

export let level1 = [];

export function initLevel() {
    // 1. Копируем карту
    level1 = rawLevel1.map(row => row.map(cell => {
        if (cell === 1 || cell === 2) {
            return { type: cell, mask: 0xFFFF }; 
        }
        return cell;
    }));

    // 2. --- ФОРТИФИКАЦИЯ БАЗЫ ---
    
    // Базовые половинки
    const LEFT_HALF   = 0x3333; // 0011...
    const RIGHT_HALF  = 0xCCCC; // 1100...
    const TOP_HALF    = 0x00FF; // Верхние 2 линии
    const BOTTOM_HALF = 0xFF00; // Нижние 2 линии

    const setWall = (r, c, mask) => {
        if (r >= 0 && r < level1.length && c >= 0 && c < level1[0].length) {
            level1[r][c] = { type: 1, mask: mask };
        }
    };

    // === НИЖНЯЯ БАЗА (Орел на 12, 6) ===
    
    // 1. Левая колонна (12, 5) -> Правая часть
    setWall(12, 5, RIGHT_HALF);
    
    // 2. Левый верхний угол (11, 5) -> Правая часть + Нижняя часть (Уголок)
    setWall(11, 5, RIGHT_HALF & BOTTOM_HALF);
    
    // 3. Крыша (11, 6) -> Нижняя часть
    setWall(11, 6, BOTTOM_HALF); 

    // 4. Правый верхний угол (11, 7) -> Левая часть + Нижняя часть
    setWall(11, 7, LEFT_HALF & BOTTOM_HALF);

    // 5. Правая колонна (12, 7) -> Левая часть
    setWall(12, 7, LEFT_HALF);


    // === ВЕРХНЯЯ БАЗА (Орел на 0, 6) ===
    
    // 1. Левая колонна (0, 5) -> Правая часть
    setWall(0, 5, RIGHT_HALF);

    // 2. Левый нижний угол (1, 5) -> Правая часть + Верхняя часть
    setWall(1, 5, RIGHT_HALF & TOP_HALF);

    // 3. Пол (1, 6) -> Верхняя часть
    setWall(1, 6, TOP_HALF);

    // 4. Правый нижний угол (1, 7) -> Левая часть + Верхняя часть
    setWall(1, 7, LEFT_HALF & TOP_HALF);

    // 5. Правая колонна (0, 7) -> Левая часть
    setWall(0, 7, LEFT_HALF);
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