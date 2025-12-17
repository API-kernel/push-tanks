import { TILE_BIG_SIZE } from '../shared/config.js';

function getTankFrames(row, colStart) {
    return [
        [colStart * TILE_BIG_SIZE, row * TILE_BIG_SIZE, TILE_BIG_SIZE, TILE_BIG_SIZE],
        [(colStart + 1) * TILE_BIG_SIZE, row * TILE_BIG_SIZE, TILE_BIG_SIZE, TILE_BIG_SIZE]
    ];
}

export const SPRITES = {
    player_green_lvl1: getTankFrames(8, 0),
    player_green_lvl2: getTankFrames(9, 0),
    player_green_lvl3: getTankFrames(10, 0),
    player_green_lvl4: getTankFrames(11, 0),

    player_yellow_lvl1: getTankFrames(0, 0),
    player_yellow_lvl2: getTankFrames(1, 0),
    player_yellow_lvl3: getTankFrames(2, 0),
    player_yellow_lvl4: getTankFrames(3, 0),
    // --- БОТЫ (Обычные) ---

    // ЖЕЛТЫЕ БОТЫ (Team 1) - Ряды 4-7
    // Basic (Row 4), Fast (Row 5), Armor (Row 6)
    bot_yellow_basic: getTankFrames(4, 0),
    bot_yellow_fast:  getTankFrames(5, 0),
    bot_yellow_armor: getTankFrames(6, 0),
    bot_yellow_heavy: getTankFrames(7, 0),

    // ЗЕЛЕНЫЕ БОТЫ (Team 2) - Ряды 12-15
    bot_green_basic: getTankFrames(12, 0),
    bot_green_fast:  getTankFrames(13, 0),
    bot_green_armor: getTankFrames(14, 0),
    bot_green_heavy: getTankFrames(15, 0),

    // --- БОТЫ (Бонусные / Красные) ---
    // Они находятся справа (X+128, col 8)
    // Для Желтых (Rows 4-7, Cols 8-9)
    bot_yellow_basic_red: getTankFrames(12, 8),
    bot_yellow_fast_red:  getTankFrames(13, 8),
    bot_yellow_armor_red: getTankFrames(14, 8),
    bot_yellow_heavy_red: getTankFrames(15, 8),

    // Для Зеленых (Rows 12-15, Cols 8-9)
    bot_green_basic_red: getTankFrames(12, 8),
    bot_green_fast_red:  getTankFrames(13, 8),
    bot_green_armor_red: getTankFrames(14, 8),
    bot_green_heavy_red: getTankFrames(15, 8),

    bullet: {
        UP:    [323, 102, 3, 4],
        DOWN:  [339, 102, 3, 4],
        LEFT:  [330, 102, 4, 3],
        RIGHT: [346, 102, 4, 3]
    },

    // Блоки и остальное оставляем как есть...
    blocks: {
        0: null, 
        1: [256, 0,  16, 16], // Кирпич
        2: [256, 16, 16, 16], // Бетон
        3: [272, 32, 16, 16], // Лес
        4: [
            [256, 48, 16, 16],
            [272, 48, 16, 16]
        ],
        5: [288, 32, 16, 16], // Лед
        6: [256 + 8, 0, 8, 16] 
    },
    base_yellow_alive: [304, 32, 16, 16], 
    base_yellow_dead:  [320, 32, 16, 16],
    base_green_alive:  [304, 48, 16, 16],
    base_green_dead:   [320, 48, 16, 16],
    shield: [
        [256, 144, 16, 16],
        [272, 144, 16, 16]
    ],
    spawn_appear: [
        [256, 96, 16, 16],
        [272, 96, 16, 16],
        [288, 96, 16, 16],
        [304, 96, 16, 16]
    ],
    explosion_small: [
        [256, 128, 16, 16], [272, 128, 16, 16], [288, 128, 16, 16]
    ],
    explosion_big: [
        [304, 128, 32, 32], [336, 128, 32, 32] 
    ],
    bonuses: {
        helmet:  [256, 112, 16, 16],
        clock:   [272, 112, 16, 16],
        shovel:  [288, 112, 16, 16],
        star:    [304, 112, 16, 16],
        grenade: [320, 112, 16, 16],
        tank:    [336, 112, 16, 16],
        gun:     [352, 112, 16, 16]
    },
    ui: {
        nums: [
            [328, 184, 8, 8], 
            [336, 184, 8, 8], 
            [344, 184, 8, 8], 
            [352, 184, 8, 8], 
            [360, 184, 8, 8], 
            [328, 192, 8, 8], 
            [336, 192, 8, 8], 
            [344, 192, 8, 8], 
            [352, 192, 8, 8], 
            [360, 192, 8, 8]  
        ],
        icon_bot:        [320, 184, 8, 8],
        icon_tank_yellow:[320, 193, 8, 8],
        icon_tank_green: [320, 200, 8, 8],
        flag:      [376, 184, 32, 16],
        ip:        [376, 136, 16, 8], 
        iip:       [376, 160, 16, 8], 
        tank_icon: [376, 144, 8, 8]   
    },
};