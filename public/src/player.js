import { TILE_SIZE, SPRITES } from './sprites.js';
import { destroyBlockAt } from './level.js';
import { createBullet, bullets } from './bullet.js';
import { updateTankMovement, drawTank } from './tank.js'; 
import { TANK_STATS } from './config.js'; 
import { teamManager } from './team_manager.js';
import { audio } from './audio.js'; // <--- ВЕРНУЛИ АУДИО

const SPAWN_PRIORITY = [4, 8, 0, 12];

export const players = [
    // ИГРОК 1 (WASD + Space)
    {
        id: 1, team: 1,
        x: 0, y: 0,
        speed: TANK_STATS.player.speed, 
        hp: TANK_STATS.player.hp,
        direction: 'UP', isMoving: false, 
        frameIndex: 0, frameTimer: 0, 
        bulletCooldown: 0, level: 1,
        shieldTimer: 0, 
        isSpawning: true, spawnTimer: 0, spawnFrameIndex: 0,
        lives: 3,
        
        keys: { 
            up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', 
            fire: 'Space' // Удобно под левую руку
        } 
    },
    // ИГРОК 2 (Стрелки + Enter/RightCtrl)
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
        lives: 3,
        
        keys: { 
            up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', 
            fire: 'Enter' // Или 'ControlRight'
        } 
    }
];

export function startPlayerSpawn(p) {
    p.isSpawning = true;
    p.spawnTimer = 0;
    p.shieldTimer = 0;
    p.level = 1;

    const colIndex = (p.id - 1) % SPAWN_PRIORITY.length;
    const col = SPAWN_PRIORITY[colIndex];

    const teamConfig = teamManager.getTeam(p.team);
    const spawnY = teamConfig ? teamConfig.spawnPixelY : 12 * TILE_SIZE;
    
    p.x = col * TILE_SIZE;
    p.y = spawnY;

    if (teamConfig) {
        p.direction = teamConfig.direction;
    }

    destroyBlockAt(p.x, p.y);
}

export function killPlayer(p) {
    p.lives--;
    if (p.lives >= 0) { 
        console.log(`Player ${p.id} died. Lives left: ${p.lives}`);
        startPlayerSpawn(p);
        return false;
    } else {
        console.log(`Player ${p.id} GAME OVER`);
        p.x = -1000; p.y = -1000; 
        return true;
    }
}

export function updatePlayers(input, gameWidth, gameHeight, onCheckCollision) {
    players.forEach(p => {
        if (p.lives < 0) return;

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
        let direction = input.getDirection(p.keys);

        // ЗВУК МОТОРА (Только для P1 пока, чтобы не шуметь, или для всех локальных)
        // audio.updateEngine(p.id, !!direction); 

        if (direction) {
            updateTankMovement(p, direction, gameWidth, gameHeight, onCheckCollision);
        } else {
            p.isMoving = false;
        }
                    
        if (!p.isSpawning) {
            audio.updateEngine(p.id, p.isMoving);
        }

        // 4. СТРЕЛЬБА
        if (p.bulletCooldown > 0) p.bulletCooldown--;
        
        if (input.keys[p.keys.fire]) {
            const maxBullets = (p.level >= 3) ? 2 : 1;
            const myBullets = bullets.filter(b => b.ownerId === p.id && !b.isDead).length;
            
            if (p.bulletCooldown === 0 && myBullets < maxBullets) {
                createBullet(p);
                audio.play('fire'); // <--- ВЕРНУЛИ ЗВУК!
                p.bulletCooldown = (p.level >= 2) ? 15 : 25; 
            }
        }
    });
}

export function drawPlayers(ctx, spritesImage) {
    players.forEach(p => {
        if (p.lives < 0) return;

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