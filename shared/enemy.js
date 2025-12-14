import { SPAWN_DELAY, TANK_STATS, MAP_WIDTH, MAP_HEIGHT } from './config.js';
import { createBullet } from './bullet.js';
import { destroyBlockAt } from './level.js';
import { updateTankMovement } from './tank.js';
import { spawnBonus } from './bonus.js';


const ENEMY_TYPES = [
    { type: 'basic', spriteKey: 'basic', ...TANK_STATS.basic, bulletLvl: 1 },
    { type: 'fast',  spriteKey: 'fast',  ...TANK_STATS.fast,  bulletLvl: 1 },
    { type: 'armor', spriteKey: 'armor', ...TANK_STATS.armor, bulletLvl: 2 },
    { type: 'heavy', spriteKey: 'heavy', ...TANK_STATS.heavy, bulletLvl: 2 },
];

export function hitEnemy(room, index) {
    const enemy = room.enemies[index];
    const result = { isDead: false, bonusDropped: false };

    if (enemy.isBonus) {
        room.activeBonus = spawnBonus(); 
        result.bonusDropped = true;
    }

    enemy.hp--;
    if (enemy.hp <= 0) {
        room.enemies.splice(index, 1);
        result.isDead = true;
    }
    return result;
}

// ГЛАВНАЯ ФУНКЦИЯ
export function updateEnemies(room) {
    const { map, teamManager, teamSpawnTimers, enemies, pendingSpawns, settings } = room;
    // Достаем активных игроков для лимитов
    const playerCounts = {};
    teamManager.getTeams().forEach(t => playerCounts[t.id] = 0);
    Object.values(room.players).forEach(p => { if(!p.isDead) playerCounts[p.team]++; });

    // Проверка часов
    const clockActiveTeam = (room.effectTimers.clock > 0) ? room.effectTimers.clockTeam : null;

    // 1. СПАВН
    const teams = teamManager.getTeams();
    teams.forEach(team => {
        if (teamSpawnTimers[team.id] === undefined) teamSpawnTimers[team.id] = 0;

        // Считаем кол-во ботов этой команды
        const spawned = room.botsSpawnedCount[team.id] || 0;
        const totalReserve = settings.botsReserve[team.id] || 0;
        
        // Если резерв исчерпан - не спавним
        if (spawned >= totalReserve) return;

        // Лимит активных
        const activeCount = (playerCounts[team.id] || 0) + 
                            enemies.filter(e => e.team === team.id).length + 
                            pendingSpawns.filter(s => s.team === team.id).length;

        // Лимит активных берем из настроек комнаты
        if (activeCount < settings.maxActiveEnemies) {
            teamSpawnTimers[team.id]++;
            if (teamSpawnTimers[team.id] > SPAWN_DELAY) {
                // Собираем busyEntities для умного спавна
                const busyEntities = [...Object.values(room.players), ...enemies, ...pendingSpawns];
                const point = teamManager.getSpawnPoint(team.id, busyEntities);
                
                if (point) {
                    createSpawnAnimation(room, team.id, point.x, point.y);
                    teamSpawnTimers[team.id] = 0;
                    
                    // Увеличиваем счетчик заспавненных
                    if (!room.botsSpawnedCount[team.id]) room.botsSpawnedCount[team.id] = 0;
                    room.botsSpawnedCount[team.id]++;
                }
            }
        }
    });

    // 2. ЗВЕЗДОЧКИ
    for (let i = room.pendingSpawns.length - 1; i >= 0; i--) {
        const s = room.pendingSpawns[i];
        s.timer++;
        if (s.timer % 4 === 0) {
            s.frameIndex++;
            if (s.frameIndex >= 4) s.frameIndex = 0;
        }

        if (s.timer > 60) { 
            spawnTankFromStar(room, s);
            room.pendingSpawns.splice(i, 1);
        }
    }

    // 3. БОТЫ
    const collisionFunc = room.checkGlobalCollision.bind(room);

    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];

        if (clockActiveTeam && enemy.team !== clockActiveTeam) continue;

        if (!enemy.isMoving || Math.random() < 0.005) {
            changeDirection(enemy);
        }

        const moved = updateTankMovement(enemy, enemy.direction, MAP_WIDTH, MAP_HEIGHT, map, collisionFunc);
        
        if (!moved) {
            if (Math.random() < 0.5) changeDirection(enemy);
        } else {
            enemy.frameTimer++; // Синхронизация анимации
        }

        enemy.bulletTimer--;
        if (enemy.bulletTimer <= 0) {
            // Передаем список пуль комнаты и карту
            createBullet(enemy, room.bullets, room.map);
            room.bulletEvents.push({ type: 'ENEMY_FIRE', x: enemy.x, y: enemy.y }); // Опционально звук
            enemy.bulletTimer = 60 + Math.random() * 35;
        }
    }
}

function createSpawnAnimation(room, teamId, x, y) {
    room.pendingSpawns.push({ x, y, team: teamId, timer: 0, frameIndex: 0 });
}

function spawnTankFromStar(room, star) {
    destroyBlockAt(room.map, star.x, star.y);

    const rand = Math.random();
    let template = ENEMY_TYPES[0];
    if (rand < 0.4) template = ENEMY_TYPES[0];      // Basic
    else if (rand < 0.6) template = ENEMY_TYPES[1]; // Fast
    else if (rand < 0.8) template = ENEMY_TYPES[2]; // Armor
    else template = ENEMY_TYPES[3];                 // Heavy

    const teamConfig = room.teamManager.getTeam(star.team);
    const startDir = teamConfig ? teamConfig.direction : 'DOWN';

    // Шанс бонуса
    const isBonus = Math.random() < 0.3;

    room.enemies.push({
        id: room.enemyIdCounter++,
        team: star.team, 
        x: star.x,
        y: star.y,
        width: 16, height: 16,
        direction: startDir,
        speed: template.speed,
        hp: template.hp,
        type: template.type,     
        spriteKey: template.spriteKey,
        bulletLvl: template.bulletLvl,
        isMoving: true,
        bulletTimer: 60,
        frameIndex: 0,
        frameTimer: 0,
        isBonus: isBonus
    });
}

function changeDirection(enemy) {
    const rand = Math.random();
    // Предпочтение по команде
    const isRed = (enemy.team === 2);
    const forward = isRed ? 'DOWN' : 'UP';
    
    if (rand < 0.25) enemy.direction = forward;
    else if (rand < 0.5) enemy.direction = (forward === 'UP') ? 'DOWN' : 'UP';
    else if (rand < 0.75) enemy.direction = 'LEFT';
    else enemy.direction = 'RIGHT'; 

    enemy.x = Math.round(enemy.x);
    enemy.y = Math.round(enemy.y);
}