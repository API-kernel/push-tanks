import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

import { initLevel, level1, destroyBlockAt } from './shared/level.js'; // <--- destroyBlockAt
import { updateBullets, bullets, createBullet } from './shared/bullet.js';
import { updateEnemies, enemies, hitEnemy } from './shared/enemy.js';
import { updateTankMovement } from './shared/tank.js'; 
import { teamManager } from './shared/team_manager.js';
import { checkRectOverlap } from './shared/utils.js';
import { MAP_WIDTH, MAP_HEIGHT, TANK_STATS } from './shared/config.js';
import { spawnBonus, getActiveBonus, checkBonusCollection } from './shared/bonus.js'; // <--- Бонусы
import { HELMET_DURATION, SHOVEL_DURATION, CLOCK_DURATION, TILE_SIZE } from './shared/config.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

const players = {}; 
let isGameOver = false;
let gameOverTimer = 0;

// Таймеры эффектов
const effectTimers = { shovel: 0, shovelTeam: 0, clock: 0, clockTeam: 0 };

initLevel();

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    const teamId = 1; 
    const pIndex = getNextPlayerIndex();
    const sp = getPlayerSpawnPoint(pIndex, teamId);
    const spawnPoint = teamManager.getSpawnPoint(teamId, []);
    
    players[socket.id] = {
        id: socket.id,
        team: teamId,
        x: spawnPoint ? spawnPoint.x : 0,
        y: spawnPoint ? spawnPoint.y : 0,
        speed: TANK_STATS.player.speed,
        playerIndex: pIndex, 
        x: sp.x, y: sp.y,
        lives: 2,
        score: 0,
        direction: 'UP',
        isMoving: false,
        hp: 1,
        bulletCooldown: 0,
        cheatCooldown: 0,
        level: 1,
        isDead: false,
        respawnTimer: 0,
        isSpawning: true, 
        spawnAnimTimer: 0,
        shieldTimer: 180, 
        inputs: { up: false, down: false, left: false, right: false, fire: false, cheat0: false } // cheat0
    };

    // Очищаем место спавна при подключении
    destroyBlockAt(players[socket.id].x, players[socket.id].y);

    socket.emit('map_init', level1);

    socket.on('input', (data) => {
        if (players[socket.id]) {
            players[socket.id].inputs = data;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

// ... (функции checkGlobalCollision, resetGame, applyServerBonus БЕЗ ИЗМЕНЕНИЙ) ...
// Я их тут скрою для краткости, они те же, что были.
// НО! Не забудь вставить функцию applyServerBonus (из прошлого шага) сюда.

const checkGlobalCollision = (targetX, targetY, currX, currY, excludeId) => {
    const targetRect = { x: targetX + 2, y: targetY + 2, width: 12, height: 12 };
    const currentRect = { x: currX + 2, y: currY + 2, width: 12, height: 12 };
    const check = (entity) => {
        if (entity.id === excludeId) return false;
        if (entity.isSpawning || entity.isDead) return false;
        if (checkRectOverlap(targetRect, entity)) {
            if (checkRectOverlap(currentRect, entity)) return false; 
            return true; 
        }
        return false;
    };
    for (const id in players) if (check(players[id])) return true;
    for (const e of enemies) if (check(e)) return true;

    // Сквозь базу проехать нельзя никогда
    const bases = teamManager.getAllBases();
    for (const base of bases) {
        // База - это прямоугольник 16x16
        if (checkRectOverlap(targetRect, base)) {
            return true; // Стена!
        }
    }

    return false;
};

// ... resetGame ... (без изменений)

function applyServerBonus(player, type) {
    // Вставь сюда код из предыдущего ответа (switch case)
    // ...
    // Для краткости пишу только суть:
    if (type === 'helmet') player.shieldTimer = HELMET_DURATION;
    if (type === 'clock') { effectTimers.clock = CLOCK_DURATION; effectTimers.clockTeam = player.team; }
    if (type === 'shovel') { effectTimers.shovel = SHOVEL_DURATION; effectTimers.shovelTeam = player.team; teamManager.fortifyBase(player.team, true); }
    if (type === 'star') { player.level++; if(player.level>4) player.level=4; }
    if (type === 'gun') player.level = 4;
    if (type === 'grenade') {
        for(let i=enemies.length-1; i>=0; i--) {
            if(enemies[i].team !== player.team) { enemies[i].hp=0; hitEnemy(i); }
        }
    }
    if (type === 'tank') { if(player.lives !== undefined) player.lives++; } // lives надо добавить в объект игрока выше
}


setInterval(() => {
    if (isGameOver) {
        // ... (код геймовера тот же)
        // ...
        io.emit('state', { players, enemies, bullets, events: [], map: level1, bases: teamManager.getAllBases(), isGameOver: true, bonus: getActiveBonus() });
        return;
    }

    if (effectTimers.clock > 0) effectTimers.clock--;
    if (effectTimers.shovel > 0) {
        effectTimers.shovel--;
        if (effectTimers.shovel === 0) teamManager.fortifyBase(effectTimers.shovelTeam, false);
    }

    // 1. ИГРОКИ
    for (const id in players) {
        const p = players[id];
        
        if (p.isDead) {
            p.respawnTimer--;
            if (p.respawnTimer <= 0) {
                p.isDead = false;
                p.isSpawning = true;
                p.spawnAnimTimer = 0;
                
                const sp = getPlayerSpawnPoint(p.playerIndex, p.team);
                p.x = sp ? sp.x : 0;
                p.y = sp ? sp.y : 0;
                p.level = 1;
                
                // --- ИЗМЕНЕНИЕ: Очистка места при респауне ---
                destroyBlockAt(p.x, p.y);
            }
            continue; 
        }

        // --- ИЗМЕНЕНИЕ: Чит-код (0) ---
        if (p.cheatCooldown > 0) p.cheatCooldown--;
        if (p.inputs.cheat0 && p.cheatCooldown <= 0) {
            // Спавним бонус перед игроком (чуть выше)
            spawnBonus(p.x, p.y - 32);
            p.cheatCooldown = 30; // 0.5 сек задержка
        }

        if (p.isSpawning) {
            p.spawnAnimTimer++;
            if (p.spawnAnimTimer > 60) {
                p.isSpawning = false;
                p.shieldTimer = 180;
            }
            continue; 
        }

        // Бонусы
        const bonusType = checkBonusCollection(p);
        if (bonusType) applyServerBonus(p, bonusType);

        if (p.shieldTimer > 0) p.shieldTimer--;
        
        const input = p.inputs;
        let direction = null;
        if (input.up) direction = 'UP';
        else if (input.down) direction = 'DOWN';
        else if (input.left) direction = 'LEFT';
        else if (input.right) direction = 'RIGHT';

        if (direction) {
            updateTankMovement(p, direction, MAP_WIDTH, MAP_HEIGHT, checkGlobalCollision);
        } else {
            p.isMoving = false;
        }

        if (p.bulletCooldown > 0) p.bulletCooldown--;
        if (input.fire) {
            const myBullets = bullets.filter(b => b.ownerId === p.id && !b.isDead).length;
            const maxBullets = (p.level >= 3) ? 2 : 1; 
            if (p.bulletCooldown === 0 && myBullets < maxBullets) {
                createBullet(p);
                p.bulletCooldown = (p.level >= 2) ? 15 : 25; 
            }
        }
    }

    // 2. ВРАГИ
    const playerCounts = {};
    teamManager.getTeams().forEach(t => playerCounts[t.id] = 0);
    Object.values(players).forEach(p => playerCounts[p.team]++);
    const allEntities = [...Object.values(players), ...enemies];
    const clockActiveTeam = (effectTimers.clock > 0) ? effectTimers.clockTeam : null;
    
    updateEnemies(MAP_WIDTH, MAP_HEIGHT, checkGlobalCollision, playerCounts, allEntities, clockActiveTeam);

    // 3. ПУЛИ
    const bulletEvents = updateBullets(MAP_WIDTH, MAP_HEIGHT);

    // 4. КОЛЛИЗИИ
    const targets = [...enemies, ...Object.values(players).filter(p => !p.isDead && !p.isSpawning)];

    bullets.forEach(b => {
        if (b.isDead) return;

        for (const otherB of bullets) {
            if (b !== otherB && !otherB.isDead && b.team !== otherB.team) {
                if (checkRectOverlap(b, otherB)) {
                    b.isDead = true; otherB.isDead = true;
                    bulletEvents.push({ type: 'BULLET_CLASH', x: b.x, y: b.y });
                }
            }
        }
        if (b.isDead) return;

        // Базы
        const bases = teamManager.getAllBases();
        bases.forEach(base => {
            if (base.isDead) return;
            if (checkRectOverlap(b, base)) {
                b.isDead = true;
                teamManager.destroyBase(base.team);
                bulletEvents.push({ type: 'BASE_DESTROY', x: base.x, y: base.y });
                isGameOver = true;
            }
        });

        // Танки
        for (const tank of targets) {
            if (b.team !== tank.team) {
                if (checkRectOverlap(b, tank)) {
                    b.isDead = true;
                    if (tank.shieldTimer > 0) {
                        bulletEvents.push({ type: 'SHIELD_HIT', x: tank.x, y: tank.y });
                        break; 
                    }
                    let isDead = false;
                    if (tank.inputs) isDead = true; 
                    else {
                        const idx = enemies.indexOf(tank);
                        if (idx !== -1) isDead = hitEnemy(idx);
                    }
                    if (isDead) {
                        bulletEvents.push({ type: 'TANK_EXPLODE', x: tank.x, y: tank.y });
                        if (tank.inputs) {
                            tank.isDead = true;
                            tank.respawnTimer = 180;
                            tank.x = -1000;
                        }
                    } else {
                        bulletEvents.push({ type: 'ARMOR_HIT', x: tank.x, y: tank.y });
                    }
                    break;
                }
            }
        }
    });

    // 5. ОТПРАВКА
    io.emit('state', {
        players,
        enemies,
        bullets,
        events: bulletEvents,
        map: level1,
        bases: teamManager.getAllBases(), // <-- ОТПРАВЛЯЕМ БАЗЫ
        isGameOver,
        bonus: getActiveBonus()
    });

}, 1000 / 60);

function getNextPlayerIndex() {
    // Ищем, занят ли слот 0?
    const existing = Object.values(players);
    if (!existing.find(p => p.playerIndex === 0)) return 0;
    if (!existing.find(p => p.playerIndex === 1)) return 1;
    return 2; // Зритель
}

function getPlayerSpawnPoint(pIndex, teamId) {
    const priority = [4, 8, 0, 12];
    const col = priority[pIndex % priority.length];
    
    const team = teamManager.getTeam(teamId);
    const y = team ? team.spawnPixelY : 0;
    
    return { x: col * TILE_SIZE, y: y };
}

const PORT = 3000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));