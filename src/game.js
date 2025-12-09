console.log("Загрузка game.js...");

import { SPRITES, TILE_SIZE } from './sprites.js';
import { InputHandler } from './input.js';
import { level1, drawMapLayers, drawForest, initLevel } from './level.js'; 
import { updateBullets, drawBullets, bullets } from './bullet.js';
import { createExplosion, updateExplosions, drawExplosions, EXPLOSION_BIG } from './explosion.js';
import { updateEnemies, drawEnemies, enemies, hitEnemy } from './enemy.js';
import { updatePlayers, drawPlayers, startPlayerSpawn, players } from './player.js'; // <--- Новое
import { checkRectOverlap } from './utils.js'; 
import { TEAMS, ACTIVE_TEAMS } from './constants.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const PADDING = 32;
const MAP_ROWS = 13;
const MAP_COLS = 13; // Выровняли под твою карту 13x13
const MAP_WIDTH = MAP_COLS * TILE_SIZE;   
const MAP_HEIGHT = MAP_ROWS * TILE_SIZE; 

canvas.width = MAP_WIDTH + PADDING * 2;
canvas.height = MAP_HEIGHT + PADDING * 2;

const game = {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    sprites: new Image(),
    isLoaded: false,
    input: new InputHandler()
};

const gameState = { isGameOver: false };

const bases = [
    { id: 1, team: TEAMS.GREEN, x: 6 * TILE_SIZE, y: 12 * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE, isDead: false },
    { id: 2, team: TEAMS.RED, x: 6 * TILE_SIZE, y: 0 * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE, isDead: false }
];

// --- ГЛОБАЛЬНАЯ ПРОВЕРКА КОЛЛИЗИЙ (Для движения) ---
// Передается в updatePlayers и updateEnemies
const checkGlobalCollision = (targetX, targetY, currX, currY, excludeId) => {
    // Хитбокс для проверки (чуть меньше клетки, чтобы не цепляться)
    const targetRect = { x: targetX + 2, y: targetY + 2, width: 12, height: 12 };
    const currentRect = { x: currX + 2, y: currY + 2, width: 12, height: 12 };

    const checkEntity = (entity) => {
        if (entity.id === excludeId) return false;
        if (entity.isSpawning) return false;

        // Если мы наедем на танк в новом месте...
        if (checkRectOverlap(targetRect, entity)) {
            // ...проверяем, были ли мы в нем в старом месте?
            if (checkRectOverlap(currentRect, entity)) {
                return false; // Уже внутри -> можно ехать (выталкивание)
            }
            return true; // Снаружи -> нельзя ехать
        }
        return false;
    };

    for (const p of players) if (checkEntity(p)) return true;
    for (const e of enemies) if (checkEntity(e)) return true;

    return false;
};

game.sprites.onload = () => {
    console.log("Картинка загружена, старт!");
    initLevel(); 
    // Спавним игроков
    players.forEach(p => startPlayerSpawn(p));
    game.isLoaded = true;
    requestAnimationFrame(loop);
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

function update() {
    if (gameState.isGameOver) { updateExplosions(); return; }

    // 1. ОБНОВЛЕНИЕ СУЩНОСТЕЙ
    updatePlayers(game.input, game.width, game.height, checkGlobalCollision);
    updateBullets(game.width, game.height);
    
    // Считаем активных игроков по командам
    const playerCounts = { 1: 0, 2: 0 };
    players.forEach(p => { if(!p.isSpawning) playerCounts[p.team]++; });
    
    // ПЕРЕДАЕМ СПИСОК АКТИВНЫХ КОМАНД
    updateEnemies(game.width, game.height, checkGlobalCollision, playerCounts, [TEAMS.GREEN, TEAMS.RED]);

    updateExplosions();

    // 2. БОЕВАЯ ЛОГИКА (Коллизии Пуль)
    const allTanks = [...enemies, ...players.filter(p => !p.isSpawning)];

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
        bases.forEach(base => {
            if (base.isDead) return;
            if (checkRectOverlap(b, base)) {
                b.isDead = true;
                base.isDead = true;
                createExplosion(base.x + 8, base.y + 8, EXPLOSION_BIG);
                if (base.team === TEAMS.GREEN) console.log("GREEN LOST"); 
                else console.log("RED LOST");
                gameState.isGameOver = true;
            }
        });

        // C. Пуля vs Танк
        for (const tank of allTanks) {
            // Урон только врагам (или Friendly Fire, если убрать проверку team)
            if (b.team !== tank.team) {
                if (checkRectOverlap(b, tank)) {
                    b.isDead = true;
                    
                    // Проверка Щита
                    // (Для врагов это поле undefined, так что false)
                    if (tank.shieldTimer > 0) {
                        createExplosion(tank.x + 8, tank.y + 8, 'SMALL');
                        break; 
                    }

                    // Нанесение урона
                    let isDead = false;
                    
                    // Если это игрок (у него есть keys, значит игрок, или просто проверяем массив)
                    if (players.includes(tank)) {
                        isDead = true; // Игрок умирает с 1 выстрела
                    } else {
                        // Это бот
                        const idx = enemies.indexOf(tank);
                        if (idx !== -1) isDead = hitEnemy(idx);
                    }

                    if (isDead) {
                        createExplosion(tank.x + 8, tank.y + 8, EXPLOSION_BIG);
                        if (players.includes(tank)) {
                            console.log(`PLAYER ${tank.id} DIED`);
                            startPlayerSpawn(tank); // Респаун
                        }
                    } else {
                        createExplosion(tank.x + 8, tank.y + 8, 'SMALL'); // Броня
                    }
                    break;
                }
            }
        }
    });
}

function draw() {
    ctx.fillStyle = '#636363';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!game.isLoaded) return;

    ctx.save();
    ctx.translate(PADDING, PADDING);

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, game.width, game.height);

    if (typeof drawMapLayers === 'function') drawMapLayers(ctx, game.sprites, level1, Date.now()); 

    bases.forEach(base => {
        const baseSprite = base.isDead ? SPRITES.base.dead : SPRITES.base.alive;
        ctx.drawImage(game.sprites, baseSprite[0], baseSprite[1], baseSprite[2], baseSprite[3], base.x, base.y, 16, 16);
    });

    drawBullets(ctx, game.sprites);
    drawEnemies(ctx, game.sprites);
    drawPlayers(ctx, game.sprites); // <--- Теперь используем правильную функцию!
    drawExplosions(ctx, game.sprites);

    if (typeof drawForest === 'function') drawForest(ctx, game.sprites, level1); 

    if (gameState.isGameOver) {
        ctx.fillStyle = 'red';
        ctx.font = 'bold 20px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText("GAME OVER", game.width / 2, game.height / 2);
    }

    ctx.restore();
}

game.sprites.src = './assets/sprites.png';