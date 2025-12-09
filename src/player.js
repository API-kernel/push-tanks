import { TILE_SIZE, SPRITES } from './sprites.js';
import { destroyBlockAt } from './level.js';
import { createBullet, bullets } from './bullet.js';
import { updateTankMovement, drawTank } from './tank.js'; 
import { TANK_STATS } from './config.js'; 
import { teamManager } from './team_manager.js';

// Приоритет колонок для спавна игроков: P1->4, P2->8, P3->0, P4->12
const SPAWN_PRIORITY = [4, 8, 0, 12];

export const players = [
    // Игрок 1 (Зеленый) -> Будет спавниться на 4
    {
        id: 1, team: 1,
        x: 0, y: 0, // Задастся при спавне
        speed: TANK_STATS.player.speed, 
        hp: TANK_STATS.player.hp,
        direction: 'UP', isMoving: false, 
        frameIndex: 0, frameTimer: 0, 
        bulletCooldown: 0, level: 1,
        shieldTimer: 0, 
        isSpawning: true, spawnTimer: 0, spawnFrameIndex: 0,
        keys: { fire: 'Space' } 
    },
    // Игрок 2 (Зеленый, Манекен) -> Будет спавниться на 8
    {
        id: 2, team: 1,
        x: 0, y: 0,
        speed: TANK_STATS.player.speed,
        hp: TANK_STATS.player.hp,
        direction: 'UP', isMoving: false, 
        frameIndex: 0, frameTimer: 0, 
        bulletCooldown: 0, level: 1,
        shieldTimer: 0,
        isSpawning: true, spawnTimer: 0, spawnFrameIndex: 0,
        keys: { fire: 'Enter' } 
    }
];

export function startPlayerSpawn(p) {
    p.isSpawning = true;
    p.spawnTimer = 0;
    p.shieldTimer = 0;
    p.level = 1; 
    
    // --- ЖЕСТКИЙ РАСЧЕТ ПОЗИЦИИ ---
    
    // 1. Выбираем колонку на основе ID
    // (ID 1 -> index 0 -> col 4)
    // (ID 2 -> index 1 -> col 8)
    const colIndex = (p.id - 1) % SPAWN_PRIORITY.length;
    const col = SPAWN_PRIORITY[colIndex];

    // 2. Выбираем ряд (Y) на основе команды
    // Спрашиваем у менеджера, где спавнится эта команда (верх или низ)
    const teamConfig = teamManager.getTeam(p.team);
    const spawnY = teamConfig ? teamConfig.spawnPixelY : 12 * TILE_SIZE;
    
    // 3. Устанавливаем координаты
    p.x = col * TILE_SIZE;
    p.y = spawnY;

    // 4. Устанавливаем направление
    if (teamConfig) {
        p.direction = teamConfig.direction;
    }

    // 5. Чистим место (стены, лес, воду)
    destroyBlockAt(p.x, p.y);
}

export function updatePlayers(input, gameWidth, gameHeight, onCheckCollision) {
    players.forEach(p => {
        // 1. СПАВН
        if (p.isSpawning) {
            p.spawnTimer++;
            if (p.spawnTimer % 4 === 0) p.spawnFrameIndex = (p.spawnFrameIndex + 1) % 4;
            if (p.spawnTimer > 60) {
                p.isSpawning = false;
                p.shieldTimer = 180;
            }
            return;
        }

        // 2. ЩИТ
        if (p.shieldTimer > 0) p.shieldTimer--;

        // 3. ДВИЖЕНИЕ
        let direction = null;
        // Управление пока только для P1
        if (p.id === 1) direction = input.getDirection(); 

        if (direction) {
            updateTankMovement(p, direction, gameWidth, gameHeight, onCheckCollision);
        } else {
            p.isMoving = false;
        }

        // 4. СТРЕЛЬБА
        if (p.bulletCooldown > 0) p.bulletCooldown--;
        
        if (p.id === 1 && input.keys[p.keys.fire]) {
            const maxBullets = (p.level >= 3) ? 2 : 1;
            const myBullets = bullets.filter(b => b.ownerId === p.id && !b.isDead).length;
            
            if (p.bulletCooldown === 0 && myBullets < maxBullets) {
                createBullet(p);
                p.bulletCooldown = (p.level >= 2) ? 15 : 25; 
            }
        }
    });
}

export function drawPlayers(ctx, spritesImage) {
    players.forEach(p => {
        if (p.isSpawning) {
            const frame = SPRITES.spawn_appear[p.spawnFrameIndex];
            if (frame) {
                const [sx, sy, sw, sh] = frame;
                ctx.drawImage(spritesImage, sx, sy, sw, sh, p.x, p.y, TILE_SIZE, TILE_SIZE);
            }
        } else {
            drawTank(ctx, spritesImage, p);
        }
    });
}