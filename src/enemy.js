import { TILE_SIZE, SPRITES } from './sprites.js';
import { canMoveTo } from './physics.js';
import { createBullet } from './bullet.js';
import { checkRectOverlap, drawRotated } from './utils.js';

export const enemies = [];

const SPAWN_POINTS = [
    { x: 0 * TILE_SIZE, y: 0 },
    { x: 6 * TILE_SIZE, y: 0 },
    { x: 12 * TILE_SIZE, y: 0 }
];

// --- ОБНОВЛЕННЫЕ КОНСТАНТЫ ---
const ENEMY_TYPES = [
    { type: 'basic', sprite: 'enemy_basic', speed: 0.5, hp: 1, bulletSpeedLvl: 1 },
    { type: 'fast',  sprite: 'enemy_fast',  speed: 1.2, hp: 1, bulletSpeedLvl: 1 }, // Быстрый стал 1.2
    { type: 'armor', sprite: 'enemy_armor', speed: 0.4, hp: 4, bulletSpeedLvl: 2 }  // Броня 0.4
];

let spawnTimer = 0;
const SPAWN_DELAY = 120; 
const MAX_ENEMIES = 4;
let enemyIdCounter = 1000;

export function hitEnemy(index) {
    const enemy = enemies[index];
    enemy.hp--;
    if (enemy.hp <= 0) {
        enemies.splice(index, 1);
        return true; 
    }
    return false; 
}

export function updateEnemies(gameWidth, gameHeight, onCheckCollision) {
    // 1. Спавн
    if (enemies.length < MAX_ENEMIES) {
        spawnTimer++;
        if (spawnTimer > SPAWN_DELAY) {
            spawnEnemy(onCheckCollision);
            spawnTimer = 0;
        }
    }

    // 2. Обновление
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];

        // ИИ: Смена направления
        if (!enemy.isMoving || Math.random() < 0.005) {
            changeDirection(enemy);
        }

        let nextX = enemy.x;
        let nextY = enemy.y;
        
        if (enemy.direction === 'UP') nextY -= enemy.speed;
        else if (enemy.direction === 'DOWN') nextY += enemy.speed;
        else if (enemy.direction === 'LEFT') nextX -= enemy.speed;
        else if (enemy.direction === 'RIGHT') nextX += enemy.speed;

        const isInside = nextX >= 0 && nextY >= 0 && nextX <= gameWidth - TILE_SIZE && nextY <= gameHeight - TILE_SIZE;

        // Проверка движения
        if (isInside && canMoveTo(nextX, nextY) && !onCheckCollision(nextX, nextY, enemy.id)) {
            enemy.x = nextX;
            enemy.y = nextY;
            enemy.isMoving = true;
            
            enemy.frameTimer++;
            // Анимация зависит от скорости
            const animSpeed = (enemy.speed > 0.8) ? 4 : 8;
            if (enemy.frameTimer > animSpeed) {
                enemy.frameTimer = 0;
                enemy.frameIndex = (enemy.frameIndex === 0) ? 1 : 0;
            }
        } else {
            enemy.isMoving = false;
            // Если уперлись - пытаемся повернуть чаще
            if (Math.random() < 0.5) changeDirection(enemy);
        }

        // --- СТРЕЛЬБА (Обновлено по твоей логике) ---
        enemy.bulletTimer--;
        if (enemy.bulletTimer <= 0) {
            createBullet({
                ...enemy, 
                // У бронированного танка пуля быстрее? (В коде ты прислал level: 1 для всех)
                // Оставим 1, как ты просил.
                level: 1 
            });
            // Рандом от 60 до 95 кадров (1-1.5 сек)
            enemy.bulletTimer = 60 + Math.random() * 35;
        }
    }
}

function spawnEnemy(onCheckCollision) {
    const spawnPoint = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    
    // Строгая проверка перед спавном
    if (onCheckCollision && onCheckCollision(spawnPoint.x, spawnPoint.y, -1)) {
        return; // Место занято, не спавним
    }

    const rand = Math.random();
    let template = ENEMY_TYPES[0];
    if (rand > 0.6) template = ENEMY_TYPES[1];
    if (rand > 0.9) template = ENEMY_TYPES[2];

    enemies.push({
        id: enemyIdCounter++,
        team: 2, 
        x: spawnPoint.x,
        y: spawnPoint.y,
        width: 16, height: 16,
        direction: 'DOWN',
        speed: template.speed,
        hp: template.hp,
        type: template.type,     
        spriteKey: template.sprite,
        isMoving: true,
        frameIndex: 0,
        frameTimer: 0,
        bulletTimer: 60
    });
}

function changeDirection(enemy) {
    const rand = Math.random();
    // Предпочтение ехать вниз (к игроку)
    if (rand < 0.5) enemy.direction = 'DOWN';
    else if (rand < 0.65) enemy.direction = 'LEFT';
    else if (rand < 0.8) enemy.direction = 'RIGHT';
    else enemy.direction = 'UP';
    
    // ВАЖНО: Выравнивание координат (Grid Snap)
    // Поскольку скорость дробная (0.4, 1.2), координаты могут стать "кривыми" (напр. 100.4).
    // Это вызывает застревание в стенах при повороте.
    // При каждом повороте мы округляем позицию до целого пикселя.
    enemy.x = Math.round(enemy.x);
    enemy.y = Math.round(enemy.y);
    
    // Можно даже жестче - до 2px или 4px, но Math.round должно хватить для 12px хитбокса.
}

export function drawEnemies(ctx, spritesImage) {
    enemies.forEach(enemy => {
        // Получаем массив кадров для этого типа врага
        // Теперь это просто массив [frame1, frame2], без направлений
        const frames = SPRITES[enemy.spriteKey];
        
        if (frames) {
            const frame = frames[enemy.frameIndex];
            const [sx, sy, sw, sh] = frame;
            
            // Рисуем с поворотом
            drawRotated(
                ctx, 
                spritesImage, 
                sx, sy, sw, sh, 
                Math.round(enemy.x), Math.round(enemy.y), TILE_SIZE, TILE_SIZE, 
                enemy.direction // Передаем направление ('UP', 'LEFT'...)
            );
        }
    });
}