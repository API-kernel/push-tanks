import { TILE_SIZE, SPRITES } from './sprites.js';
import { canMoveTo } from './physics.js';
import { createBullet } from './bullet.js';
import { destroyBlockAt } from './level.js';
import { drawRotated } from './utils.js';
import { teamManager } from './team_manager.js'; // <--- Берем команды отсюда
import { SPAWN_DELAY } from './config.js';

export const enemies = [];
export const pendingSpawns = [];

// Точки по X (для карты 13x13: Лево, Центр, Право)
// Используем SPAWN_COLUMNS из конфига или локально, если там не экспортировано. 
// Лучше возьмем локально для надежности, или из teamManager
const SPAWN_COLS = [0, 4, 8, 12]; // Для ширины 13

const ENEMY_TYPES = [
    { type: 'basic', sprite: 'enemy_basic', speed: 0.5, hp: 1, bulletSpeedLvl: 1 },
    { type: 'fast',  sprite: 'enemy_fast',  speed: 1.0, hp: 1, bulletSpeedLvl: 1 },
    { type: 'armor', sprite: 'enemy_armor', speed: 0.4, hp: 4, bulletSpeedLvl: 2 }
];

let enemyIdCounter = 2000;

export function hitEnemy(index) {
    const enemy = enemies[index];
    enemy.hp--;
    if (enemy.hp <= 0) {
        enemies.splice(index, 1);
        return true; 
    }
    return false; 
}

// СИГНАТУРА: 5 АРГУМЕНТОВ
export function updateEnemies(gameWidth, gameHeight, onCheckCollision, playerCounts, allTanks) {
    
    // 1. СПАВН (Проходим по командам из Менеджера)
    const teams = teamManager.getTeams();

    teams.forEach(team => {
        // Считаем активных юнитов
        const activeCount = (playerCounts[team.id] || 0) + 
                            enemies.filter(e => e.team === team.id).length + 
                            pendingSpawns.filter(s => s.team === team.id).length;

        // Берем лимит из объекта команды
        if (activeCount < team.maxUnits) {
            team.spawnTimer++;
            if (team.spawnTimer > SPAWN_DELAY) {
                // Пытаемся найти точку спавна
                // spread [...allTanks, ...pendingSpawns] работает, так как allTanks передан аргументом
                const busyEntities = [...(allTanks || []), ...pendingSpawns];
                const point = teamManager.getSpawnPoint(team.id, busyEntities);
                
                if (point) {
                    createSpawnAnimation(team.id, point.x, point.y);
                    team.spawnTimer = 0;
                }
            }
        }
    });

    // 2. ОБНОВЛЕНИЕ ЗВЕЗДОЧЕК
    for (let i = pendingSpawns.length - 1; i >= 0; i--) {
        const s = pendingSpawns[i];
        s.timer++;
        
        if (s.timer % 4 === 0) {
            s.frameIndex++;
            if (s.frameIndex >= 4) s.frameIndex = 0;
        }

        if (s.timer > 60) { 
            spawnTankFromStar(s);
            pendingSpawns.splice(i, 1);
        }
    }

    // 3. ОБНОВЛЕНИЕ ВРАГОВ
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];

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

        if (isInside && canMoveTo(nextX, nextY) && !onCheckCollision(nextX, nextY, enemy.x, enemy.y, enemy.id)) {
            enemy.x = nextX;
            enemy.y = nextY;
            enemy.isMoving = true;
            
            enemy.frameTimer++;
            const animSpeed = (enemy.speed > 0.8) ? 4 : 8;
            if (enemy.frameTimer > animSpeed) {
                enemy.frameTimer = 0;
                enemy.frameIndex = (enemy.frameIndex === 0) ? 1 : 0;
            }
        } else {
            enemy.isMoving = false;
            if (Math.random() < 0.5) changeDirection(enemy);
        }

        // Стрельба
        enemy.bulletTimer--;
        if (enemy.bulletTimer <= 0) {
            createBullet({
                ...enemy, 
                level: (enemy.type === 'armor') ? 1 : 1 
            });
            enemy.bulletTimer = 60 + Math.random() * 35;
        }
    }
}

function createSpawnAnimation(teamId, x, y) {
    pendingSpawns.push({
        x, y, team: teamId, timer: 0, frameIndex: 0
    });
}

function spawnTankFromStar(star) {
    destroyBlockAt(star.x, star.y);

    const rand = Math.random();
    let template = ENEMY_TYPES[0];
    if (rand > 0.6) template = ENEMY_TYPES[1];
    if (rand > 0.9) template = ENEMY_TYPES[2];

    const teamConfig = teamManager.getTeam(star.team);
    const startDir = teamConfig ? teamConfig.direction : 'DOWN';

    enemies.push({
        id: enemyIdCounter++,
        team: star.team, 
        x: star.x,
        y: star.y,
        width: 16, height: 16,
        direction: startDir,
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
    if (rand < 0.25) enemy.direction = 'DOWN';
    else if (rand < 0.5) enemy.direction = 'UP';
    else if (rand < 0.75) enemy.direction = 'LEFT';
    else enemy.direction = 'RIGHT'; 

    enemy.x = Math.round(enemy.x);
    enemy.y = Math.round(enemy.y);
}

export function drawEnemies(ctx, spritesImage) {
    // Звездочки
    pendingSpawns.forEach(s => {
        const frame = SPRITES.spawn_appear[s.frameIndex];
        if (frame) {
            const [sx, sy, sw, sh] = frame;
            ctx.drawImage(spritesImage, sx, sy, sw, sh, s.x, s.y, TILE_SIZE, TILE_SIZE);
        }
    });

    // Танки (через drawRotated)
    enemies.forEach(enemy => {
        const frames = SPRITES[enemy.spriteKey];
        if (frames) {
            const frame = frames[enemy.frameIndex];
            const [sx, sy, sw, sh] = frame;
            
            drawRotated(
                ctx, 
                spritesImage,
                sx, sy, sw, sh,
                Math.round(enemy.x), Math.round(enemy.y), TILE_SIZE, TILE_SIZE,
                enemy.direction
            );
        }
    });
}