export const TILE_SIZE = 8;
export const TILE_BIG_SIZE = 16;

export const MAP_ROWS = 26;
export const MAP_COLS = 26;
export const PADDING = 32;
export const HUD_WIDTH = 32;

export const MAP_WIDTH = MAP_COLS * TILE_SIZE;
export const MAP_HEIGHT = MAP_ROWS * TILE_SIZE;

export const CANVAS_WIDTH = PADDING + MAP_WIDTH + HUD_WIDTH + 16; 
export const CANVAS_HEIGHT = MAP_HEIGHT + PADDING * 2;

export const SPAWN_DELAY = 120; 
export const SPAWN_ANIMATION_DURATION = 60; 
export const SHIELD_DURATION = 180; 

export const SPAWN_COLUMNS = [0, 8, 16, 24];

// Просто массив настроек.
export const TEAMS_CONFIG = [
    {
        id: 1,
        name: 'GREEN',
        maxUnits: 4, 
        baseXY: { x: 12, y: 24 }, 
        spawnY: 24,              
        direction: 'UP'          
    },
    {
        id: 2,
        name: 'RED',
        maxUnits: 4,
        baseXY: { x: 12, y: 0 },
        spawnY: 0,
        direction: 'DOWN'
    }
];

export const TANK_STATS = {
    player: { speed: 1.0, hp: 1, bulletSpeed: 3, bulletSpeedFast: 5 },
    basic:  { speed: 0.6, hp: 1, bulletSpeed: 3 },
    fast:   { speed: 1.2, hp: 1, bulletSpeed: 3 },
    armor:  { speed: 0.5, hp: 1, bulletSpeed: 5 },
    heavy:  { speed: 0.6, hp: 3, bulletSpeed: 5 },
};

export const BONUS_WEIGHTS = {
    'star': 25,
    'grenade': 10,
    'clock': 15,
    'helmet': 15,
    'tank': 15,
    'gun': 5,
    'shovel': 15
};

export const HELMET_DURATION = 300; 
export const SHOVEL_DURATION = 1000;
export const CLOCK_DURATION  = 600;

export const BLOCK_FULL = 0xF; // 1111

export const BASE_WALLS = {
    [1]: [ // Низ
        // Слева
        {r:25,c:11}, {r:24,c:11}, {r:23,c:11},
        // Верх
        {r:23,c:12}, {r:23,c:13},
        // Справа
        {r:23,c:14}, {r:24,c:14}, {r:25,c:14}
    ],
    [2]: [ // Верх
        {r:0,c:11}, {r:1,c:11}, {r:2,c:11},
        {r:2,c:12}, {r:2,c:13},
        {r:2,c:14}, {r:1,c:14}, {r:0,c:14}
    ]
};