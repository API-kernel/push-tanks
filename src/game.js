console.log("Загрузка game.js...");

import { SPRITES, TILE_SIZE } from './sprites.js';
import { InputHandler } from './input.js';
import { level1, drawMapLayers, drawForest, initLevel } from './level.js'; 
import { canMoveTo } from './physics.js'; 
import { createBullet, updateBullets, drawBullets, bullets } from './bullet.js';
import { createExplosion, updateExplosions, drawExplosions, EXPLOSION_BIG } from './explosion.js';
import { updateEnemies, drawEnemies, enemies, hitEnemy } from './enemy.js';
import { checkRectOverlap, drawRotated } from './utils.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const PADDING = 32;
const MAP_ROWS = 13;
const MAP_COLS = 15; 
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

const gameState = {
    isGameOver: false
};

const TEAMS = { GREEN: 1, RED: 2 };

const bases = [
    { id: 1, team: TEAMS.GREEN, x: 6 * TILE_SIZE, y: 12 * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE, isDead: false },
    { id: 2, team: TEAMS.RED, x: 6 * TILE_SIZE, y: 0 * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE, isDead: false }
];

const player = {
    id: 1, team: TEAMS.GREEN,
    x: 4 * TILE_SIZE, y: 12 * TILE_SIZE,
    speed: 1, direction: 'UP', isMoving: false, 
    frameIndex: 0, frameTimer: 0, animationSpeed: 8, bulletCooldown: 0, level: 1,
    shieldTimer: 180 
};

// --- ФУНКЦИЯ ПРОВЕРКИ ЗАНЯТОСТИ МЕСТА ТАНКОМ ---
// Используется и игроком, и врагами, чтобы не наезжать друг на друга
const checkGlobalCollision = (x, y, excludeId) => {
    // ХИТБОКС ТАНКА (Collision Box)
    // Делаем его меньше визуального размера (16x16).
    // Было 14x14 (+1), стало 12x12 (+2).
    // Это позволяет танкам проезжать впритирку и не зацепляться углами.
    const rect = { 
        x: x + 2, 
        y: y + 2, 
        width: 12, 
        height: 12 
    };

    // 1. Проверка с Игроком
    if (player.id !== excludeId) {
        if (checkRectOverlap(rect, player)) return true;
    }

    // 2. Проверка с Врагами
    for (const enemy of enemies) {
        if (enemy.id !== excludeId) {
            if (checkRectOverlap(rect, enemy)) return true;
        }
    }

    return false;
};

game.sprites.onload = () => {
    console.log("Картинка загружена, старт!");
    initLevel(); 
    game.isLoaded = true;
    requestAnimationFrame(loop);
};

game.sprites.onerror = () => {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: Картинка ./assets/sprites.png не найдена!");
};

function loop() {
    try {
        update();
        draw();
        requestAnimationFrame(loop);
    } catch (e) {
        console.error("ИГРА УПАЛА:", e);
    }
}

function update() {
    if (gameState.isGameOver) {
        updateExplosions();
        return; 
    }

    // --- ИГРОК ---
    if (player.shieldTimer > 0) player.shieldTimer--;

    if (game.input.keys['Digit1']) { player.level = 1; console.log("Lvl 1"); }
    if (game.input.keys['Digit4']) { player.level = 4; console.log("Lvl 4"); }

    const direction = game.input.getDirection();
    if (direction) {
        player.isMoving = true;
        player.direction = direction;
        let nextX = player.x;
        let nextY = player.y;

        if (direction === 'UP') nextY -= player.speed;
        else if (direction === 'DOWN') nextY += player.speed;
        else if (direction === 'LEFT') nextX -= player.speed;
        else if (direction === 'RIGHT') nextX += player.speed;

        const isInsideMap = 
            nextX >= 0 && nextY >= 0 && 
            nextX <= game.width - TILE_SIZE && nextY <= game.height - TILE_SIZE;

        // ДВИЖЕНИЕ: Границы && Стены && Танки
        if (isInsideMap && canMoveTo(nextX, nextY) && !checkGlobalCollision(nextX, nextY, player.id)) {
            player.x = nextX;
            player.y = nextY;
            player.frameTimer++;
            if (player.frameTimer > player.animationSpeed) {
                player.frameTimer = 0;
                player.frameIndex = (player.frameIndex === 0) ? 1 : 0;
            }
        }
    } else {
        player.isMoving = false;
    }

    if (player.bulletCooldown > 0) player.bulletCooldown--;

    if (game.input.keys['Space']) {
        const maxBullets = (player.level >= 3) ? 2 : 1;
        
        // Считаем пули, у которых ownerId совпадает с моим ID
        const myBulletsCount = bullets.filter(b => b.ownerId === player.id && !b.isDead).length;
        
        // console.log("Пуль:", myBulletsCount, "Макс:", maxBullets); // Раскомментируй для проверки

        if (player.bulletCooldown === 0 && myBulletsCount < maxBullets) {
            createBullet(player);
            player.bulletCooldown = (player.level >= 2) ? 15 : 25; 
        }
    }

    // --- СИСТЕМЫ ---
    updateBullets(game.width, game.height);
    
    // Передаем функцию проверки коллизий врагам!
    updateEnemies(game.width, game.height, checkGlobalCollision);
    
    updateExplosions();

    // --- КОЛЛИЗИИ ---

    // 1. ПУЛЯ vs ПУЛЯ
    for (let i = 0; i < bullets.length; i++) {
        for (let j = i + 1; j < bullets.length; j++) {
            const b1 = bullets[i];
            const b2 = bullets[j];
            if (b1.isDead || b2.isDead) continue;

            // Сбиваем, только если разные команды (Игрок vs Враг)
            if (b1.team !== b2.team && checkRectOverlap(b1, b2)) {
                b1.isDead = true;
                b2.isDead = true;
            }
        }
    }

    bullets.forEach(b => {
        if (b.isDead) return;

        // 2. ПУЛЯ vs БАЗА
        bases.forEach(base => {
            if (base.isDead) return;
            if (checkRectOverlap(b, base)) {
                b.isDead = true;
                base.isDead = true;
                createExplosion(base.x + 8, base.y + 8, EXPLOSION_BIG);
                if (base.team === TEAMS.GREEN) {
                    gameState.isGameOver = true;
                    console.log("GREEN BASE DESTROYED!");
                }
            }
        });

        // 3. ПУЛЯ ИГРОКА vs ВРАГ
        if (b.ownerId === player.id) { // Используем ID
            for (let i = enemies.length - 1; i >= 0; i--) {
                const enemy = enemies[i];
                if (checkRectOverlap(b, enemy)) {
                    b.isDead = true; 
                    const isDead = hitEnemy(i); 
                    if (isDead) {
                        createExplosion(enemy.x + 8, enemy.y + 8, EXPLOSION_BIG);
                    } else {
                        createExplosion(enemy.x + 8, enemy.y + 8, 'SMALL'); 
                    }
                    break;
                }
            }
        }
        
        // 4. ПУЛЯ ВРАГА vs ИГРОК
        if (b.team === TEAMS.RED) { // Если пуля вражеская
            if (checkRectOverlap(b, player)) {
                 b.isDead = true;
                 if (player.shieldTimer <= 0) {
                     console.log("PLAYER DIED!");
                     createExplosion(player.x + 8, player.y + 8, EXPLOSION_BIG);
                     respawnPlayer();
                 }
            }
        }
    });
}

function respawnPlayer() {
    player.x = 4 * TILE_SIZE;
    player.y = 12 * TILE_SIZE;
    player.direction = 'UP';
    player.level = 1; 
    player.shieldTimer = 180; 
}

function draw() {
    ctx.fillStyle = '#636363';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!game.isLoaded) return;

    ctx.save();
    ctx.translate(PADDING, PADDING);

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, game.width, game.height);

    // Слой 1: Земля и Стены
    if (typeof drawMapLayers === 'function') drawMapLayers(ctx, game.sprites, level1, Date.now()); 

    bases.forEach(base => {
        const baseSprite = base.isDead ? SPRITES.base.dead : SPRITES.base.alive;
        ctx.drawImage(game.sprites, baseSprite[0], baseSprite[1], baseSprite[2], baseSprite[3], base.x, base.y, 16, 16);
    });

    // Слой 2: Танки и Пули
    drawBullets(ctx, game.sprites);
    drawEnemies(ctx, game.sprites);
    
    if (!gameState.isGameOver) { 
        // Теперь SPRITES.player - это просто массив кадров
        const frames = SPRITES.player;
        if (frames) {
            const frame = frames[player.frameIndex];
            if (frame) {
                const [sx, sy, sWidth, sHeight] = frame;
                
                // Используем вращение
                drawRotated(
                    ctx, game.sprites,
                    sx, sy, sWidth, sHeight,
                    Math.round(player.x), Math.round(player.y), TILE_SIZE, TILE_SIZE,
                    player.direction
                );
            }
        }
        
        // Отрисовка щита (щит крутить не надо, он круглый/симметричный)
        if (player.shieldTimer > 0) {
            const shieldFrameIndex = Math.floor(Date.now() / 50) % 2;
            const shieldFrame = SPRITES.shield[shieldFrameIndex];
            if (shieldFrame) {
                const [sx, sy, sw, sh] = shieldFrame;
                ctx.drawImage(game.sprites, sx, sy, sw, sh, Math.round(player.x), Math.round(player.y), TILE_SIZE, TILE_SIZE);
            }
        }
    }

    drawExplosions(ctx, game.sprites); // Взрывы поверх танков

    // Слой 3: Лес
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