export const TILE_SIZE = 16;

export const MAP_ROWS = 13;
export const MAP_COLS = 13;
export const PADDING = 32;
export const HUD_WIDTH = 32;

export const MAP_WIDTH = MAP_COLS * TILE_SIZE;
export const MAP_HEIGHT = MAP_ROWS * TILE_SIZE;

export const CANVAS_WIDTH = PADDING + MAP_WIDTH + HUD_WIDTH + 16; 
export const CANVAS_HEIGHT = MAP_HEIGHT + PADDING * 2;

export const SPAWN_DELAY = 120; 
export const SPAWN_ANIMATION_DURATION = 60; 
export const SHIELD_DURATION = 180; 

export const SPAWN_COLUMNS = [0, 4, 8, 12];

// Просто массив настроек.
export const TEAMS_CONFIG = [
    {
        id: 1,
        name: 'GREEN',
        maxUnits: 4, 
        baseXY: { x: 6, y: 12 }, 
        spawnY: 12,              
        direction: 'UP'          
    },
    {
        id: 2,
        name: 'RED',
        maxUnits: 4,
        baseXY: { x: 6, y: 0 },
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

// Маски стен
export const WALL_MASKS = {
    LEFT:   0x3333,
    RIGHT:  0xCCCC,
    TOP:    0x00FF,
    BOTTOM: 0xFF00,
    FULL:   0xFFFF
};

// Стены вокруг баз
export const BASE_WALLS = {
    [1]: [ // GREEN (Низ)
        { r: 12, c: 5, mask: WALL_MASKS.RIGHT },
        { r: 11, c: 5, mask: WALL_MASKS.RIGHT & WALL_MASKS.BOTTOM },
        { r: 11, c: 6, mask: WALL_MASKS.BOTTOM },
        { r: 11, c: 7, mask: WALL_MASKS.LEFT & WALL_MASKS.BOTTOM },
        { r: 12, c: 7, mask: WALL_MASKS.LEFT }
    ],
    [2]: [ // RED (Верх)
        { r: 0, c: 5, mask: WALL_MASKS.RIGHT },
        { r: 1, c: 5, mask: WALL_MASKS.RIGHT & WALL_MASKS.TOP },
        { r: 1, c: 6, mask: WALL_MASKS.TOP },
        { r: 1, c: 7, mask: WALL_MASKS.LEFT & WALL_MASKS.TOP },
        { r: 0, c: 7, mask: WALL_MASKS.LEFT }
    ]
};