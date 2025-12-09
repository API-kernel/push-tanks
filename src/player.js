import { TILE_SIZE, SPRITES } from './sprites.js';
import { canMoveTo } from './physics.js';
import { destroyBlockAt } from './level.js';
import { createBullet, bullets } from './bullet.js';
import { drawRotated } from './utils.js'; // Используем нашу утилиту
import { TEAMS, ACTIVE_TEAMS } from './constants.js';


// МАССИВ ИГРОКОВ
export const players = [
    // Игрок 1
    {
        id: 1, team: TEAMS.GREEN,
        x: 4 * TILE_SIZE, y: 12 * TILE_SIZE,
        speed: 1, direction: 'UP', isMoving: false, 
        frameIndex: 0, frameTimer: 0, animationSpeed: 8, bulletCooldown: 0, level: 1,
        shieldTimer: 0, 
        isSpawning: true, spawnTimer: 0, spawnFrameIndex: 0,
        keys: { fire: 'Space' } // Остальное управление берем глобально пока
    },
    // Игрок 2 (Манекен для тестов)
    {
        id: 2, team: TEAMS.GREEN,
        x: 8 * TILE_SIZE, y: 12 * TILE_SIZE,
        speed: 1, direction: 'UP', isMoving: false, 
        frameIndex: 0, frameTimer: 0, animationSpeed: 8, bulletCooldown: 0, level: 1,
        shieldTimer: 0,
        isSpawning: true, spawnTimer: 0, spawnFrameIndex: 0,
        keys: { fire: 'Enter' } 
    }
];

export function startPlayerSpawn(p) {
    p.isSpawning = true;
    p.spawnTimer = 0;
    // Можно добавить рандомный выбор точки спавна (0, 6, 12), но пока оставим как в конфиге
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

        // 3. УПРАВЛЕНИЕ И ДВИЖЕНИЕ
        // (Пока управляем только ID=1 через стрелки)
        let direction = null;
        if (p.id === 1) direction = input.getDirection();

        if (direction) {
            p.isMoving = true;
            p.direction = direction;
            let nextX = p.x;
            let nextY = p.y;

            if (direction === 'UP') nextY -= p.speed;
            else if (direction === 'DOWN') nextY += p.speed;
            else if (direction === 'LEFT') nextX -= p.speed;
            else if (direction === 'RIGHT') nextX += p.speed;

            const isInsideMap = 
                nextX >= 0 && nextY >= 0 && 
                nextX <= gameWidth - TILE_SIZE && nextY <= gameHeight - TILE_SIZE;

            // onCheckCollision - это checkGlobalCollision из game.js
            if (isInsideMap && canMoveTo(nextX, nextY) && !onCheckCollision(nextX, nextY, p.x, p.y, p.id)) {
                p.x = nextX;
                p.y = nextY;
                p.frameTimer++;
                if (p.frameTimer > p.animationSpeed) {
                    p.frameTimer = 0;
                    p.frameIndex = (p.frameIndex === 0) ? 1 : 0;
                }
            }
        } else {
            p.isMoving = false;
        }

        // 4. СТРЕЛЬБА
        if (p.bulletCooldown > 0) p.bulletCooldown--;
        
        // Проверяем кнопку стрельбы
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
        // Анимация появления
        if (p.isSpawning) {
            const frame = SPRITES.spawn_appear[p.spawnFrameIndex];
            if (frame) {
                const [sx, sy, sw, sh] = frame;
                ctx.drawImage(spritesImage, sx, sy, sw, sh, p.x, p.y, TILE_SIZE, TILE_SIZE);
            }
            return;
        }

        // Танк
        const frames = SPRITES.player; // Массив [кадр1, кадр2] (смотрят вверх)
        if (frames) {
            const frame = frames[p.frameIndex];
            if (frame) {
                const [sx, sy, sw, sh] = frame;
                // ИСПОЛЬЗУЕМ drawRotated
                drawRotated(
                    ctx, spritesImage,
                    sx, sy, sw, sh,
                    Math.round(p.x), Math.round(p.y), TILE_SIZE, TILE_SIZE,
                    p.direction
                );
            }
        }

        // Щит (рисуем обычно, без вращения)
        if (p.shieldTimer > 0) {
            const shieldFrameIndex = Math.floor(Date.now() / 50) % 2;
            const shieldFrame = SPRITES.shield[shieldFrameIndex];
            if (shieldFrame) {
                const [sx, sy, sw, sh] = shieldFrame;
                ctx.drawImage(spritesImage, sx, sy, sw, sh, Math.round(p.x), Math.round(p.y), TILE_SIZE, TILE_SIZE);
            }
        }
    });
}