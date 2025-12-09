console.log("Загрузка game.js...");

import { SPRITES, TILE_SIZE } from './sprites.js';
import { InputHandler } from './input.js';
import { level1, drawMapLayers, drawForest, initLevel } from './level.js'; 
import { updateBullets, drawBullets, bullets } from './bullet.js';
import { createExplosion, updateExplosions, drawExplosions, EXPLOSION_BIG } from './explosion.js';
import { updateEnemies, drawEnemies, enemies, hitEnemy } from './enemy.js';
import { updatePlayers, drawPlayers, startPlayerSpawn, players } from './player.js';
import { checkRectOverlap } from './utils.js'; 
import { teamManager } from './team_manager.js'; 
import { CANVAS_WIDTH, CANVAS_HEIGHT, MAP_WIDTH, MAP_HEIGHT, PADDING } from './config.js';
import { audio } from './audio.js';
import { spawnBonus, drawBonuses, checkBonusCollection, activeBonus } from './bonus.js';
import { HELMET_DURATION, SHOVEL_DURATION, CLOCK_DURATION, TANK_STATS } from './config.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

const game = {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    sprites: new Image(),
    isLoaded: false,
    input: new InputHandler()
};

const gameState = { isGameOver: false };

// --- ГЛОБАЛЬНАЯ КОЛЛИЗИЯ ---
const checkGlobalCollision = (targetX, targetY, currX, currY, excludeId) => {
    const targetRect = { x: targetX + 2, y: targetY + 2, width: 12, height: 12 };
    const currentRect = { x: currX + 2, y: currY + 2, width: 12, height: 12 };

    const checkEntity = (entity) => {
        if (entity.id === excludeId) return false;
        if (entity.isSpawning) return false;

        // Если мы входим в чужой хитбокс...
        if (checkRectOverlap(targetRect, entity)) {
            // ...но мы УЖЕ были в нем, разрешаем выехать
            if (checkRectOverlap(currentRect, entity)) return false; 
            return true; 
        }
        return false;
    };

    for (const p of players) if (checkEntity(p)) return true;
    for (const e of enemies) if (checkEntity(e)) return true;

    return false;
};

// --- ИНИЦИАЛИЗАЦИЯ ---
game.sprites.onload = () => {
    console.log("Картинка загружена, старт!");
    initLevel(); 
    players.forEach(p => startPlayerSpawn(p));
    game.isLoaded = true;
    requestAnimationFrame(loop);
    // audio.play('intro'); 
};

game.sprites.onerror = () => { console.error("Error loading sprites"); };

function loop() {
    try {
        update();
        draw();
        requestAnimationFrame(loop);
    } catch (e) {
        console.error("CRASH:", e);
    }
}

const effectTimers = {
    shovel: 0,
    clock: 0
};

// --- ОБНОВЛЕНИЕ ---
function update() {
    if (gameState.isGameOver) { updateExplosions(); return; }

    // 1. ИГРОКИ
    updatePlayers(game.input, game.width, game.height, checkGlobalCollision);

    // 2. ВРАГИ (БОТЫ)
    // Собираем всех для проверки занятости места спавна
    const allEntities = [
        ...players.filter(p => !p.isSpawning), 
        ...players.filter(p => p.isSpawning),  
        ...enemies                             
    ];

    const playerCounts = {}; 
    teamManager.getTeams().forEach(t => playerCounts[t.id] = 0);
    players.forEach(p => { 
        if (!p.isSpawning) playerCounts[p.team] = (playerCounts[p.team] || 0) + 1; 
    });
    
    // ВЫЗОВ: 5 аргументов
    updateEnemies(game.width, game.height, checkGlobalCollision, playerCounts, allEntities, effectTimers.clock > 0 ? effectTimers.clockTeam : null);

    // 3. ПУЛИ
    updateBullets(game.width, game.height);
    updateExplosions();

    // 4. БОЙ
    const targets = [...enemies, ...players.filter(p => !p.isSpawning)];

    bullets.forEach(b => {
        if (b.isDead) return;

        // A. Пуля vs Пуля
        for (const otherB of bullets) {
            if (b !== otherB && !otherB.isDead && b.team !== otherB.team) {
                if (checkRectOverlap(b, otherB)) {
                    b.isDead = true; otherB.isDead = true;
                }
            }
        }
        if (b.isDead) return;

        // B. Пуля vs База
        const teamsList = teamManager.getTeams();
        teamsList.forEach(team => {
            if (!team.baseAlive) return; 

            const baseRect = { 
                x: team.basePos.x, 
                y: team.basePos.y, 
                width: 16, height: 16 
            };

            if (checkRectOverlap(b, baseRect)) {
                b.isDead = true;
                teamManager.destroyBase(team.id); 
                
                createExplosion(baseRect.x + 8, baseRect.y + 8, EXPLOSION_BIG);
                
                if (team.name === 'GREEN') console.log("GREEN TEAM LOST"); 
                else console.log("RED TEAM LOST");
                
                audio.play('base_crash'); // <--- БАЗА
                
                gameState.isGameOver = true;
                
                audio.play('game_over'); // <--- КОНЕЦ
                audio.stopAll();
            }
        });

        // C. Пуля vs Танк
        for (const tank of targets) {
            if (b.team !== tank.team) {
                if (checkRectOverlap(b, tank)) {
                    b.isDead = true;
                    
                    if (tank.shieldTimer > 0) {
                        createExplosion(tank.x + 8, tank.y + 8, 'SMALL');
                        audio.play('explosion');
                        break; 
                    }

                    let isDead = false;
                    
                    if (players.includes(tank)) {
                        isDead = true; 
                    } else {
                        const idx = enemies.indexOf(tank);
                        if (idx !== -1) isDead = hitEnemy(idx); 
                    }

                    if (isDead) {
                        createExplosion(tank.x + 8, tank.y + 8, EXPLOSION_BIG);
                        
                        if (players.includes(tank)) {
                            console.log("PLAYER DIED");
                            audio.play('explosion_player'); // <--- Смерть игрока
                            startPlayerSpawn(tank);
                        } else {
                            audio.play('explosion_bot'); // <--- Смерть бота
                        }
                    } else {
                        // Попали, но не убили (Броня)
                        createExplosion(tank.x + 8, tank.y + 8, 'SMALL'); 
                        audio.play('armor_hit'); // <--- Звук брони
                    }
                    break; 
                }
            }
        }
    });

    // --- БОНУСЫ (Проверка подбора) ---
    // Проверяем каждого игрока
    players.forEach(p => {
        if (p.isSpawning) return;
        
        const bonusType = checkBonusCollection(p);
        if (bonusType) {
            applyBonus(p, bonusType);
        }
    });

    // Часы
    if (effectTimers.clock > 0) effectTimers.clock--;
    
    // Лопата
    if (effectTimers.shovel > 0) {
        effectTimers.shovel--;
        if (effectTimers.shovel === 0) {
            teamManager.fortifyBase(effectTimers.shovelTeam, false); 
        }
    }

    // ЧИТ (0)
    if (game.input.keys['Digit0']) {
        game.input.keys['Digit0'] = false; // Сброс нажатия (чтобы не спамить)
        // Спавн перед игроком
        spawnBonus(players[0].x, players[0].y - 32); 
    }
}

// --- ОТРИСОВКА ---
function draw() {
    ctx.fillStyle = '#636363';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!game.isLoaded) return;

    ctx.save();
    ctx.translate(PADDING, PADDING);

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, game.width, game.height);

    if (typeof drawMapLayers === 'function') drawMapLayers(ctx, game.sprites, level1, Date.now()); 

    const teamsList = teamManager.getTeams();
    teamsList.forEach(team => {
        const sprite = team.baseAlive ? SPRITES.base.alive : SPRITES.base.dead;
        ctx.drawImage(game.sprites, ...sprite, team.basePos.x, team.basePos.y, 16, 16);
    });

    drawBullets(ctx, game.sprites);
    drawEnemies(ctx, game.sprites);
    drawPlayers(ctx, game.sprites);
    drawExplosions(ctx, game.sprites);
    drawBonuses(ctx, game.sprites); 

    if (typeof drawForest === 'function') drawForest(ctx, game.sprites, level1); 

    if (gameState.isGameOver) {
        ctx.fillStyle = 'red';
        ctx.font = 'bold 20px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText("GAME OVER", game.width / 2, game.height / 2);
    }

    ctx.restore();
}

function applyBonus(player, type) {
    console.log("APPLY BONUS:", type);
    
    switch (type) {
        case 'helmet':
            player.shieldTimer = HELMET_DURATION;
            break;
            
        case 'clock':
            effectTimers.clock = CLOCK_DURATION;
            effectTimers.clockTeam = player.team; // Кто взял часы
            break;
            
        case 'shovel':
            effectTimers.shovel = SHOVEL_DURATION;
            // Укрепляем базу ТОЙ команды, которая взяла бонус
            teamManager.fortifyBase(player.team, true); 
            
            // Запоминаем, чью базу укрепляли, чтобы потом вернуть кирпич ИМЕННО ЕЙ
            effectTimers.shovelTeam = player.team; 
            break;
            
        case 'star':
            player.level++;
            if (player.level > 4) player.level = 4;
            break;
            
        case 'gun':
            player.level = 4;
            // + Логика кошения травы (потом)
            break;
            
        case 'grenade':
            // Взрываем всех врагов (Чужая команда)
            enemies.forEach(e => {
                if (e.team !== player.team) {
                    e.hp = 0;
                    hitEnemy(enemies.indexOf(e)); // Убьет и запустит взрыв
                    createExplosion(e.x+8, e.y+8, 'BIG');
                }
            });
            break;
            
        case 'tank':
            // +1 Жизнь (пока просто звук)
            // audio.play('life_up');
            break;
    }
}

game.sprites.src = './assets/sprites.png';