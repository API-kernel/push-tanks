export const TILE_SIZE = 16;

export const MAP_ROWS = 13;
export const MAP_COLS = 13;
export const PADDING = 32;

export const MAP_WIDTH = MAP_COLS * TILE_SIZE;
export const MAP_HEIGHT = MAP_ROWS * TILE_SIZE;
export const CANVAS_WIDTH = MAP_WIDTH + PADDING * 2;
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
    basic:  { speed: 0.5, hp: 1, bulletSpeed: 3 },
    fast:   { speed: 1.2, hp: 1, bulletSpeed: 3 },
    armor:  { speed: 0.4, hp: 4, bulletSpeed: 5 }
};