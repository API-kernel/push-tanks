import { SPAWN_DELAY, TANK_STATS  } from './config.js';
import { canMoveTo } from './physics.js';
import { createBullet } from './bullet.js';
import { destroyBlockAt } from './level.js';
import { updateTankMovement } from './tank.js';

const SPAWN_COLS = [0, 4, 8, 12];

const ENEMY_TYPES = [
    { type: 'basic', spriteKey: 'enemy_basic', ...TANK_STATS.basic, bulletLvl: 1 },
    { type: 'fast',  spriteKey: 'enemy_fast',  ...TANK_STATS.fast,  bulletLvl: 1 },
    { type: 'armor', spriteKey: 'enemy_armor', ...TANK_STATS.armor, bulletLvl: 2 }
];

export function hitEnemy(room, index) {
    const enemy = room.enemies[index];
    enemy.hp--;
    if (enemy.hp <= 0) {
        room.enemies.splice(index, 1);
        return true; 
    }
    return false; 
}

// ГЛАВНАЯ ФУНКЦИЯ
// room - это объект GameRoom (содержит enemies, pendingSpawns, map, teamManager и т.д.)
export function updateEnemies(room, gameWidth, gameHeight, onCheckCollision, playerCounts, clockActiveTeam) {
    
    // 1. СПАВН
    const teams = room.teamManager.getTeams();
    teams.forEach(team => {
        // Инициализируем таймер в комнате, если нет
        if (room.teamSpawnTimers[team.id] === undefined) room.teamSpawnTimers[team.id] = 0;

        const activeCount = (playerCounts[team.id] || 0) + 
                            room.enemies.filter(e => e.team === team.id).length + 
                            room.pendingSpawns.filter(s => s.team === team.id).length;

        // Используем лимит из менеджера
        if (activeCount < room.teamManager.getMaxUnits(team.id)) {
            room.teamSpawnTimers[team.id]++;
            if (room.teamSpawnTimers[team.id] > SPAWN_DELAY) {
                // Собираем всех занятых (танки + звездочки)
                // allTanks передается? Нет, берем из room.enemies + room.players
                // Но onCheckCollision уже проверяет игроков и врагов.
                // Для спавна нам нужны координаты.
                const busyEntities = [...Object.values(room.players), ...room.enemies, ...room.pendingSpawns];
                
                const point = room.teamManager.getSpawnPoint(team.id, busyEntities);
                
                if (point) {
                    createSpawnAnimation(room, team.id, point.x, point.y);
                    room.teamSpawnTimers[team.id] = 0;
                }
            }
        }
    });

    // 2. ЗВЕЗДОЧКИ
    for (let i = room.pendingSpawns.length - 1; i >= 0; i--) {
        const s = room.pendingSpawns[i];
        s.timer++;
        if (s.timer > 60) { 
            spawnTankFromStar(room, s);
            room.pendingSpawns.splice(i, 1);
        }
    }

    // 3. БОТЫ
    for (let i = room.enemies.length - 1; i >= 0; i--) {
        const enemy = room.enemies[i];

        if (clockActiveTeam && enemy.team !== clockActiveTeam) continue;

        if (!enemy.isMoving || Math.random() < 0.005) {
            changeDirection(enemy);
        }

        const moved = updateTankMovement(enemy, enemy.direction, gameWidth, gameHeight, room.map, onCheckCollision);
        
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
    room.pendingSpawns.push({ x, y, team: teamId, timer: 0 });
}

function spawnTankFromStar(room, star) {
    destroyBlockAt(room.map, star.x, star.y);

    const rand = Math.random();
    let template = ENEMY_TYPES[0];
    if (rand > 0.6) template = ENEMY_TYPES[1];
    if (rand > 0.9) template = ENEMY_TYPES[2];

    const teamConfig = room.teamManager.getTeam(star.team);
    const startDir = teamConfig ? teamConfig.direction : 'DOWN';

    // Шанс бонуса
    const isBonus = Math.random() < 0.15;

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