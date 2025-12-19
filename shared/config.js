export const SERVER_FPS = 60;

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

export const SPAWN_COLUMNS = [8, 16, 0, 24];
export const ENABLE_CHEATS = false; 

// Просто массив настроек.
export const TEAMS_CONFIG = [
    {
        id: 1,
        name: 'YELLOW',
        maxUnits: 4, 
        baseXY: { x: 12, y: 24 }, 
        spawnY: 24,              
        direction: 'UP'          
    },
    {
        id: 2,
        name: 'GREEN',
        maxUnits: 4,
        baseXY: { x: 12, y: 0 },
        spawnY: 0,
        direction: 'DOWN'
    }
];

const TANK_SPEED_SLOW = 35;
const TANK_SPEED_FAST = 60;

const BULLET_SPEED_SLOW = 125;
const BULLET_SPEED_FAST = 250;

export const TANK_STATS = {
    basic:  { speed: TANK_SPEED_SLOW / SERVER_FPS, hp: 1, bulletSpeed: BULLET_SPEED_SLOW / SERVER_FPS, bulletCooldown: SERVER_FPS, canBreakSteel: false, spriteKey: 'basic'},
    fast:   { speed: TANK_SPEED_FAST / SERVER_FPS, hp: 1, bulletSpeed: BULLET_SPEED_SLOW / SERVER_FPS, bulletCooldown: SERVER_FPS, canBreakSteel: false, spriteKey: 'fast',},
    armor:  { speed: TANK_SPEED_SLOW / SERVER_FPS, hp: 1, bulletSpeed: BULLET_SPEED_FAST / SERVER_FPS, bulletCooldown: SERVER_FPS, canBreakSteel: false, spriteKey: 'armor'},
    heavy:  { speed: TANK_SPEED_SLOW / SERVER_FPS, hp: 4, bulletSpeed: BULLET_SPEED_FAST / SERVER_FPS, bulletCooldown: SERVER_FPS, canBreakSteel: false, spriteKey: 'heavy'},

    player: { 
        speed: TANK_SPEED_FAST / SERVER_FPS, 
        hp: 1, 
        levels: {
            1: { bulletSpeed: BULLET_SPEED_SLOW / SERVER_FPS, bulletCount: 1, cooldown: Math.floor(0.33 * SERVER_FPS), canBreakSteel: false }, 
            2: { bulletSpeed: BULLET_SPEED_FAST / SERVER_FPS, bulletCount: 1, cooldown: Math.floor(0.20 * SERVER_FPS), canBreakSteel: false  }, 
            3: { bulletSpeed: BULLET_SPEED_FAST / SERVER_FPS, bulletCount: 2, cooldown: Math.floor(0.20 * SERVER_FPS), canBreakSteel: false  },
            4: { bulletSpeed: BULLET_SPEED_FAST / SERVER_FPS, bulletCount: 2, cooldown: Math.floor(0.20 * SERVER_FPS), canBreakSteel: true }
        }
    }
};

export const BONUS_WEIGHTS = {
    'star': 25,
    'grenade': 10,
    'clock': 15,
    'helmet': 15,
    'tank': 20,
    'gun': 1,
    'shovel': 15
};

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

export const SPAWN_DELAY = 2 * SERVER_FPS;
export const SPAWN_ANIMATION_DURATION = 1 * SERVER_FPS; 
export const RESPAWN_DELAY = 1.5 * SERVER_FPS; // 1 сек (быстрый респаун)

// Эффекты
export const SHIELD_DURATION = 3 * SERVER_FPS; // 3 сек
export const HELMET_DURATION = 5 * SERVER_FPS; // 5 сек (бонус)
export const CLOCK_DURATION  = 10 * SERVER_FPS; // 10 сек
export const SHOVEL_DURATION = 15 * SERVER_FPS; // 15 сек

export const BULLET_COOLDOWN_SLOW = 12;
export const BULLET_COOLDOWN_FAST = 8;

export const CHAT_HISTORY_LENGTH = 100;

export const TANK_SNAP_GRID = 4;
export const TANK_SNAP_TOLERANCE = 4;