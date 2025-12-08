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
    level1 = rawLevel1.map(row => row.map(cell => {
        if (cell === 1 || cell === 2) {
            // МАСКА 16 бит: 0xFFFF (сетка 4x4)
            return { type: cell, mask: 0xFFFF }; 
        }
        return cell;
    }));
}

export function drawLevel(ctx, spritesImage, levelMap) {
    if (!levelMap) return;

    for (let row = 0; row < levelMap.length; row++) {
        for (let col = 0; col < levelMap[row].length; col++) {
            const block = levelMap[row][col];
            
            if (typeof block === 'object') {
                const baseSprite = SPRITES.blocks[block.type]; 
                if (!baseSprite) continue;
                const [bx, by] = baseSprite;
                
                // Размер микро-блока 4x4
                const subSize = 4;

                for (let r = 0; r < 4; r++) { // 4 строки
                    for (let c = 0; c < 4; c++) { // 4 колонки
                        const bitIndex = r * 4 + c;
                        
                        if ((block.mask & (1 << bitIndex)) !== 0) {
                            ctx.drawImage(
                                spritesImage,
                                bx + c * subSize, by + r * subSize, subSize, subSize,
                                col * 16 + c * subSize, row * 16 + r * subSize, subSize, subSize
                            );
                        }
                    }
                }
            } else {
                const spriteCoords = SPRITES.blocks[block];
                if (spriteCoords) {
                    const [sx, sy, sw, sh] = spriteCoords;
                    ctx.drawImage(spritesImage, sx, sy, sw, sh, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                }
            }
        }
    }
}