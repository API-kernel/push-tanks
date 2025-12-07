console.log("Загрузка game.js...");

import { SPRITES, TILE_SIZE } from './sprites.js';
import { InputHandler } from './input.js';
import { level1, drawLevel } from './level.js'; 
import { canMoveTo } from './physics.js'; 
import { createBullet, updateBullets, drawBullets, bullets } from './bullet.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const game = {
    width: canvas.width,
    height: canvas.height,
    sprites: new Image(),
    isLoaded: false,
    input: new InputHandler()
};

const player = {
    x: 0,
    y: 100,
    speed: 1,
    direction: 'UP',
    isMoving: false,
    frameIndex: 0,
    frameTimer: 0,
    animationSpeed: 8,
    bulletCooldown: 0 // Таймер для стрельбы
};

// 1. Сначала определяем обработчики событий
game.sprites.onload = () => {
    console.log("Картинка загружена, старт!");
    game.isLoaded = true;
    requestAnimationFrame(loop);
};

game.sprites.onerror = () => {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: Картинка ./assets/sprites.png не найдена!");
};

// 2. Игровой цикл
function loop() {
    try {
        update();
        draw();
        requestAnimationFrame(loop);
    } catch (e) {
        console.error("ИГРА УПАЛА:", e);
    }
}

// 3. Обновление логики
function update() {
    // --- А. Движение Игрока ---
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

        // Физика
        const isInsideMap = 
            nextX >= 0 && 
            nextY >= 0 && 
            nextX <= game.width - TILE_SIZE && 
            nextY <= game.height - TILE_SIZE;

        if (isInsideMap && canMoveTo(nextX, nextY)) {
            player.x = nextX;
            player.y = nextY;

            // Анимация гусениц
            player.frameTimer++;
            if (player.frameTimer > player.animationSpeed) {
                player.frameTimer = 0;
                player.frameIndex = (player.frameIndex === 0) ? 1 : 0;
            }
        }
    } else {
        player.isMoving = false;
    }

    // --- Б. Стрельба ---
    if (player.bulletCooldown > 0) {
        player.bulletCooldown--;
    }

    // Space нет в getDirection, берем напрямую из input.keys
    if (game.input.keys['Space']) {
        // Ограничения: кулдаун прошел И пуль на экране меньше 1 (или 2, если взял бонус)
        if (player.bulletCooldown === 0 && bullets.length < 1) {
            createBullet(player);
            player.bulletCooldown = 20; // Задержка между выстрелами (~0.3 сек)
        }
    }

    // --- В. Обновление пуль ---
    updateBullets(game.width, game.height);
}

// 4. Отрисовка
function draw() {
    // Очистка
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, game.width, game.height);

    if (!game.isLoaded) return;

    // Слой 1: Карта
    if (typeof drawLevel === 'function') {
        drawLevel(ctx, game.sprites, level1);
    }

    // Слой 2: Пули (рисуем ПОД танком или НАД картой)
    drawBullets(ctx, game.sprites);

    // Слой 3: Игрок
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

// 5. Запуск загрузки (в самом конце)
game.sprites.src = './assets/sprites.png';