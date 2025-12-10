import { SPAWN_DELAY, TANK_STATS } from '../shared/config.js';
import { createBullet } from './bullet.js';
import { destroyBlockAt } from './level.js';
import { teamManager } from './team_manager.js';
import { spawnBonus } from './bonus.js';

export const enemies = [];
export const pendingSpawns = [];

// Точки спавна (0, 4, 8, 12)
const SPAWN_COLS = [0, 4, 8, 12];

const ENEMY_TYPES = [
    { type: 'basic', spriteKey: 'enemy_basic', ...TANK_STATS.basic, bulletLvl: 1 },
    { type: 'fast',  spriteKey: 'enemy_fast',  ...TANK_STATS.fast,  bulletLvl: 1 },
    { type: 'armor', spriteKey: 'enemy_armor', ...TANK_STATS.armor, bulletLvl: 2 }
];

const teamSpawnTimers = {};
let enemyIdCounter = 2000;

export function hitEnemy(index) {
    const enemy = enemies[index];
    enemy.hp--;
    if (enemy.hp <= 0) {
        if (enemy.isBonus) {
            spawnBonus();
        }
        enemies.splice(index, 1);
        return true; 
    }
    return false; 
}

export function updateEnemies(gameWidth, gameHeight, onCheckCollision, playerCounts, allTanks, clockActiveTeam) {
    
    // 1. СПАВН
    const teams = teamManager.getTeams();
    teams.forEach(team => {
        if (teamSpawnTimers[team.id] === undefined) teamSpawnTimers[team.id] = 0;

        const activeCount = (playerCounts[team.id] || 0) + 
                            enemies.filter(e => e.team === team.id).length + 
                            pendingSpawns.filter(s => s.team === team.id).length;

        // Лимит из менеджера
        if (activeCount < teamManager.getMaxUnits(team.id)) {
            teamSpawnTimers[team.id]++;
            if (teamSpawnTimers[team.id] > SPAWN_DELAY) {
                const busyEntities = [...(allTanks || []), ...pendingSpawns];
                const point = teamManager.getSpawnPoint(team.id, busyEntities);
                
                if (point) {
                    createSpawnAnimation(team.id, point.x, point.y);
                    teamSpawnTimers[team.id] = 0;
                }
            }
        }
    });

    // 2. ЗВЕЗДОЧКИ
    for (let i = pendingSpawns.length - 1; i >= 0; i--) {
        const s = pendingSpawns[i];
        s.timer++;
        // Анимацию кадров сервер не считает, только таймер жизни
        if (s.timer > 60) { 
            spawnTankFromStar(s);
            pendingSpawns.splice(i, 1);
        }
    }

    // 3. БОТЫ
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];

        if (clockActiveTeam && enemy.team !== clockActiveTeam) continue;
        
        if (!enemy.isMoving || Math.random() < 0.005) {
            changeDirection(enemy);
        }

        // --- ДВИЖЕНИЕ (Дублируем логику tank.js или импортируем updateTankMovement?)
        // Важно: updateTankMovement лежит в shared/tank.js. Импортируем!
        
        // Но updateTankMovement требует функцию движения.
        // Чтобы не создавать циклические зависимости, лучше импортировать updateTankMovement здесь.
        // (Я добавлю импорт в начале файла: import { updateTankMovement } from './tank.js')
        
        const moved = updateTankMovement(enemy, enemy.direction, gameWidth, gameHeight, onCheckCollision);
        
        if (!moved) {
            if (Math.random() < 0.5) changeDirection(enemy);
        } else {
            // Если двигается - обновляем таймер анимации (для синхронизации с клиентом)
            enemy.frameTimer++; // ...
        }

        // Стрельба
        enemy.bulletTimer--;
        if (enemy.bulletTimer <= 0) {
            createBullet({
                ...enemy, 
                level: enemy.bulletLvl 
            });
            enemy.bulletTimer = 60 + Math.random() * 35;
        }
    }
}

function createSpawnAnimation(teamId, x, y) {
    pendingSpawns.push({ x, y, team: teamId, timer: 0 });
}

function spawnTankFromStar(star) {
    destroyBlockAt(star.x, star.y);

    const rand = Math.random();
    let template = ENEMY_TYPES[0];
    if (rand > 0.6) template = ENEMY_TYPES[1];
    if (rand > 0.9) template = ENEMY_TYPES[2];

    const teamConfig = teamManager.getTeam(star.team);
    const startDir = teamConfig ? teamConfig.direction : 'DOWN';
    const isBonus = Math.random() < 0.15;

    enemies.push({
        id: enemyIdCounter++,
        team: star.team, 
        x: star.x,
        y: star.y,
        width: 16, height: 16,
        direction: startDir,
        isBonus: isBonus,
        speed: template.speed,
        hp: template.hp,
        type: template.type,     
        spriteKey: template.spriteKey,
        bulletLvl: template.bulletLvl,
        isMoving: true,
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

// Импорт updateTankMovement добавлен динамически (или добавь в начало):
import { updateTankMovement } from './tank.js';