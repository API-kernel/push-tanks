// src/level.js

// Простая карта для теста. 
// 1 = Кирпич, 2 = Бетон, 3 = Лес, 4 = Вода
// Это массив массивов (строки).
export const level1 = [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,0,0,1,1,1,0,0,1,1,1,0],
    [0,1,0,1,0,0,1,0,1,0,0,1,0,1,0],
    [0,1,1,1,0,0,1,1,1,0,0,1,1,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,0,2,2,2,2,2,2,0,1,1,0,0],
    [0,1,1,0,2,4,4,4,2,2,0,1,1,0,0],
    [0,0,0,0,2,4,4,4,2,2,0,0,0,0,0],
    [0,3,3,3,0,0,0,0,0,0,3,3,3,0,0], // Лес для теста
    [0,3,3,3,0,0,0,0,0,0,3,3,3,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,0,0,1,1,1,0,0,1,1,1,0],
    [0,1,1,1,0,0,1,1,1,0,0,1,1,1,0]
];

// Функция отрисовки карты
import { SPRITES, TILE_SIZE } from './sprites.js';

export function drawLevel(ctx, spritesImage, levelMap) {
    // Проходимся по строкам (y)
    for (let row = 0; row < levelMap.length; row++) {
        // Проходимся по ячейкам в строке (x)
        for (let col = 0; col < levelMap[row].length; col++) {
            
            const blockType = levelMap[row][col];
            const spriteCoords = SPRITES.blocks[blockType];

            // Если блок не пустой (не 0) и координаты для него есть
            if (spriteCoords) {
                const [sx, sy, sw, sh] = spriteCoords;
                
                // Рисуем блок
                ctx.drawImage(
                    spritesImage,
                    sx, sy, sw, sh,
                    col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE
                );
            }
        }
    }
}