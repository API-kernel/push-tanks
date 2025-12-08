console.log("Загрузка game.js...");

import { SPRITES, TILE_SIZE } from './sprites.js';
import { InputHandler } from './input.js';
import { level1, drawLevel, initLevel } from './level.js'; 
import { canMoveTo } from './physics.js'; 
import { createBullet, updateBullets, drawBullets, bullets } from './bullet.js';
import { createExplosion, updateExplosions, drawExplosions, EXPLOSION_BIG } from './explosion.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- ИСПРАВЛЕНИЕ: Размеры карты ---
const PADDING = 32;
const MAP_ROWS = 13;
const MAP_COLS = 15; // <--- Было 13, стало 15 (посчитай кол-во нулей в строке level.js)

const MAP_WIDTH = MAP_COLS * TILE_SIZE;   // 15 * 16 = 240px
const MAP_HEIGHT = MAP_ROWS * TILE_SIZE;  // 13 * 16 = 208px

canvas.width = MAP_WIDTH + PADDING * 2;   // 240 + 64 = 304px
canvas.height = MAP_HEIGHT + PADDING * 2; // 208 + 64 = 272px

const game = {
    width: MAP_WIDTH,  // Игровая ширина (без паддинга)
    height: MAP_HEIGHT, // Игровая высота
    sprites: new Image(),
    isLoaded: false,
    input: new InputHandler()
};

const gameState = {
    isGameOver: false
};

const TEAMS = { GREEN: 1, RED: 2 };

// Базы (координаты относительно игрового поля 0,0)
const bases = [
    {
        id: 1, team: TEAMS.GREEN,
        x: 6 * TILE_SIZE, y: 12 * TILE_SIZE,
        width: TILE_SIZE, height: TILE_SIZE, isDead: false
    },
    {
        id: 2, team: TEAMS.RED,
        x: 6 * TILE_SIZE, y: 0 * TILE_SIZE,
        width: TILE_SIZE, height: TILE_SIZE, isDead: false
    }
];

const player = {
    x: 4 * TILE_SIZE, y: 12 * TILE_SIZE, // Спавн чуть левее базы
    speed: 1, direction: 'UP', isMoving: false, 
    frameIndex: 0, frameTimer: 0, animationSpeed: 8, bulletCooldown: 0, level: 1 
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

        // Проверка границ (относительно 0,0 до MAP_WIDTH)
        const isInsideMap = 
            nextX >= 0 && nextY >= 0 && 
            nextX <= game.width - TILE_SIZE && nextY <= game.height - TILE_SIZE;

        if (isInsideMap && canMoveTo(nextX, nextY)) {
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
        if (player.bulletCooldown === 0 && bullets.length < maxBullets) {
            createBullet(player);
            player.bulletCooldown = (player.level >= 2) ? 15 : 25; 
        }
    }

    // Передаем реальные размеры поля для проверки вылета пуль
    updateBullets(game.width, game.height);
    updateExplosions();

    // Проверка баз
    bullets.forEach(b => {
        if (b.isDead) return;
        bases.forEach(base => {
            if (base.isDead) return;
            if (b.x < base.x + base.width &&
                b.x + b.width > base.x &&
                b.y < base.y + base.height &&
                b.y + b.height > base.y) {
                
                b.isDead = true;
                base.isDead = true;
                createExplosion(base.x + 8, base.y + 8, EXPLOSION_BIG);
                
                if (base.team === TEAMS.GREEN) {
                    gameState.isGameOver = true;
                    console.log("GREEN BASE DESTROYED!");
                } else {
                    console.log("RED BASE DESTROYED!");
                }
            }
        });
    });
}

function draw() {
    // 1. Рисуем серый фон (рамку) на весь канвас
    ctx.fillStyle = '#636363'; // Классический серый цвет NES
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!game.isLoaded) return;

    // 2. Сдвигаем всё рисование в центр (Padding)
    ctx.save();
    ctx.translate(PADDING, PADDING);

    // 3. Рисуем черный фон игрового поля
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, game.width, game.height);

    // 4. Отрисовка игровых объектов (координаты 0..208)
    if (typeof drawLevel === 'function') {
        drawLevel(ctx, game.sprites, level1, Date.now()); 
    }

    bases.forEach(base => {
        const baseSprite = base.isDead ? SPRITES.base.dead : SPRITES.base.alive;
        ctx.drawImage(
            game.sprites, 
            baseSprite[0], baseSprite[1], baseSprite[2], baseSprite[3],
            base.x, base.y, 16, 16
        );
    });

    drawBullets(ctx, game.sprites);
    drawExplosions(ctx, game.sprites);

    if (!gameState.isGameOver || true) { 
        const dirData = SPRITES.player[player.direction];
        if (dirData) {
            const frame = dirData[player.frameIndex];
            if (frame) {
                const [sx, sy, sWidth, sHeight] = frame;
                ctx.drawImage(
                    game.sprites,
                    sx, sy, sWidth, sHeight,
                    Math.round(player.x), Math.round(player.y), TILE_SIZE, TILE_SIZE
                );
            }
        }
    }

    if (gameState.isGameOver) {
        ctx.fillStyle = 'red';
        ctx.font = 'bold 20px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText("GAME OVER", game.width / 2, game.height / 2);
    }

    // Возвращаем координаты канваса обратно, чтобы не сломать следующий кадр
    ctx.restore();
}

game.sprites.src = './assets/sprites.png';