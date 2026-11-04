import { SPAWN_DELAY, TANK_STATS, SERVER_FPS } from './config.js';
import { destroyBlockAt } from './level.js';
import { spawnBonus, checkBonusCollection } from './bonus.js';
import { updateLegacyBot } from './ai/legacy.js';
import { botVersionFor } from './ai/versions.js';

export function hitEnemy(room, index) {
    const enemy = room.enemies[index];
    const result = { isDead: false, bonusDropped: false };

    if (enemy.isBonus) {
        const bases = room.teamManager.getAllBases();
        room.activeBonus = spawnBonus(room.map, bases, undefined, undefined, room.random);
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
    const { teamManager, teamSpawnTimers, enemies, pendingSpawns, settings } = room;

    // Проверка часов
    const clockActiveTeam = (room.effectTimers.clock > 0) ? room.effectTimers.clockTeam : null;

    // 1. СПАВН
    const teams = teamManager.getTeams();
    teams.forEach(team => {
        if (teamSpawnTimers[team.id] === undefined) teamSpawnTimers[team.id] = 0;

        // Считаем кол-во ботов этой команды
        const spawned = room.botsSpawnedCount[team.id] || 0;
        const totalReserve = (settings.botsReserve[team.id] || 0) + room.bonusReserves[team.id];
        
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
                const point = teamManager.getSpawnPoint(team.id, busyEntities, room.spawnRandom[team.id]);
                
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

    // Both policies use identical stats, spawning, physics and bonus effects.
    const versions = new Set(enemies.map(b => botVersionFor(settings, b.team)));
    for (const version of versions) room.botAIs[version]?.prepare();
    for (const enemy of [...enemies]) {
        if (!enemies.includes(enemy)) continue;
        if (enemy.shieldTimer > 0) enemy.shieldTimer--;
        if (clockActiveTeam && enemy.team !== clockActiveTeam) continue;
        const bonusType = checkBonusCollection(enemy, room.activeBonus);
        if (bonusType) {
            room.activeBonus = null;
            room.applyBonus(enemy, bonusType);
        }
        enemy.bulletTimer--;
        const version = botVersionFor(settings, enemy.team);
        if (version === 'legacy') updateLegacyBot(room, enemy);
        else room.botAIs[version].update(enemy);
    }
}

function createSpawnAnimation(room, teamId, x, y) {
    room.pendingSpawns.push({ x, y, team: teamId, timer: 0, frameIndex: 0 });
}

function spawnTankFromStar(room, star) {
    destroyBlockAt(room.map, star.x, star.y);

    const random = room.spawnRandom[star.team];
    const rand = random();
    let type = 'basic';
    if (rand < 0.4) type = 'basic';     
    else if (rand < 0.6) type = 'fast'; 
    else if (rand < 0.8) type = 'armor';
    else type = 'heavy';     

    const template = TANK_STATS[type]
    const teamConfig = room.teamManager.getTeam(star.team);
    const startDir = teamConfig ? teamConfig.direction : 'DOWN';

    // Шанс бонуса
    const isBonus = random() < 0.3;

    room.enemies.push({
        id: room.enemyIdCounter++,
        team: star.team, 
        x: star.x,
        y: star.y,
        width: 16, height: 16,
        direction: startDir,
        speed: template.speed,
        hp: template.hp,
        baseHp: template.hp,
        level: 1,
        shieldTimer: 0,
        type,
        spriteKey: template.spriteKey,
        bulletLvl: template.bulletLvl,
        bulletSpeed: template.bulletSpeed,
        bulletCooldownMax: template.bulletCooldown,
        isMoving: true,
        bulletTimer: SERVER_FPS,
        isBonus: isBonus
    });
}
