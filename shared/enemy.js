import { SPAWN_DELAY, TANK_STATS, MAP_WIDTH, MAP_HEIGHT, SERVER_FPS } from './config.js';
import { createBullet } from './bullet.js';
import { destroyBlockAt } from './level.js';
import { updateTankMovement } from './tank.js';
import { spawnBonus } from './bonus.js';

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
        const activeUnits = (room.getTeamPlayerCount(team.id) || 0) + 
                            enemies.filter(e => e.team === team.id).length + 
                            pendingSpawns.filter(s => s.team === team.id).length;

        // Лимит активных берем из настроек комнаты
        if (activeUnits < settings.maxActiveTanks) {
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
        if (s.timer % SERVER_FPS / 15 === 0) {
            s.frameIndex++;
            if (s.frameIndex >= SERVER_FPS / 15) s.frameIndex = 0;
        }

        if (s.timer > SERVER_FPS) { 
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
        }

        enemy.bulletTimer--;
        if (enemy.bulletTimer <= 0) {
            // Передаем список пуль комнаты и карту
            const bullet = createBullet(enemy, enemy.bulletSpeed);
            room.bullets.push(bullet);
            room.bulletEvents.push({ type: 'ENEMY_FIRE', x: enemy.x, y: enemy.y }); // Опционально звук
            const baseCD = enemy.bulletCooldownMax; 
            enemy.bulletTimer = baseCD + Math.random() * (baseCD / 2); 
        }
    }
}

function createSpawnAnimation(room, teamId, x, y) {
    room.pendingSpawns.push({ x, y, team: teamId, timer: 0, frameIndex: 0 });
}

function spawnTankFromStar(room, star) {
    destroyBlockAt(room.map, star.x, star.y);

    const rand = Math.random();
    let type = 'basic';
    if (rand < 0.4) type = 'basic';     
    else if (rand < 0.6) type = 'fast'; 
    else if (rand < 0.8) type = 'armor';
    else type = 'heavy';     

    const template = TANK_STATS[type]
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
        bulletSpeed: template.bulletSpeed,
        bulletCooldownMax: template.bulletCooldown,
        isMoving: true,
        bulletTimer: SERVER_FPS,
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