export const TILE_SIZE = 16;

export const SPRITES = {
    player: {
        // ВВЕРХ (2 кадра)
        UP: [
            [0 * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE],
            [1 * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE]
        ],
        // ВЛЕВО (2 кадра)
        LEFT: [
            [2 * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE],
            [3 * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE]
        ],
        // ВНИЗ (2 кадра)
        DOWN: [
            [4 * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE],
            [5 * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE]
        ],
        // ВПРАВО (2 кадра)
        RIGHT: [
            [6 * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE],
            [7 * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE]
        ]
    },
    blocks: {
        0: null, 
        1: [256, 0,  16, 16], // Кирпич
        2: [256, 16, 16, 16], // Бетон
        3: [272, 32, 16, 16], // Лес
        4: [256, 32, 16, 16], // Вода
        5: [288, 32, 16, 16], // Лед
        6: [256 + 8, 0, 8, 16] 
    },
    bullet: {
        UP:    [323, 102, 3, 4],
        DOWN:  [339, 102, 3, 4],
        LEFT:  [330, 102, 4, 3],
        RIGHT: [346, 102, 4, 3]
    }
};