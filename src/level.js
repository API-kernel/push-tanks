// src/level.js
// Убедись, что тут написано export const level1
export const level1 = [
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

// ... дальше функция отрисовки (не так важно сейчас)
import { SPRITES, TILE_SIZE } from './sprites.js';
export function drawLevel(ctx, spritesImage, levelMap) {
    // ... твой код отрисовки ...
    if (!levelMap) return; // Защита
    for (let row = 0; row < levelMap.length; row++) {
        for (let col = 0; col < levelMap[row].length; col++) {
            const blockType = levelMap[row][col];
            const spriteCoords = SPRITES.blocks[blockType];
            if (spriteCoords) {
                const [sx, sy, sw, sh] = spriteCoords;
                ctx.drawImage(spritesImage, sx, sy, sw, sh, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }
    }
}