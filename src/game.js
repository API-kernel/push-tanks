console.log("Загрузка game.js...");

import { SPRITES, TILE_SIZE } from './sprites.js';
import { InputHandler } from './input.js';
import { level1, drawLevel } from './level.js'; 
import { canMoveTo } from './physics.js'; 

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
    y: 0,
    speed: 1,
    direction: 'UP',
    isMoving: false,
    frameIndex: 0,
    frameTimer: 0,
    animationSpeed: 3
};

// 1. Сначала определяем функцию ONLOAD
game.sprites.onload = () => {
    console.log("Картинка загружена, старт!"); // <--- Должно появиться!
    game.isLoaded = true;
    requestAnimationFrame(loop);
};

// 2. Обработка ошибок загрузки
game.sprites.onerror = () => {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: Картинка ./assets/sprites.png не найдена!");
};

function loop() {
    // Оборачиваем в try-catch, чтобы видеть ошибки внутри цикла
    try {
        update();
        draw();
        requestAnimationFrame(loop);
    } catch (e) {
        console.error("ИГРА УПАЛА:", e); // Если тут будет ошибка, мы ее увидим
    }
}

function update() {
    const direction = game.input.getDirection();

    if (direction) {
        player.isMoving = true;
        player.direction = direction;

        // Физика и Движение
        let nextX = player.x;
        let nextY = player.y;

        if (direction === 'UP') nextY -= player.speed;
        else if (direction === 'DOWN') nextY += player.speed;
        else if (direction === 'LEFT') nextX -= player.speed;
        else if (direction === 'RIGHT') nextX += player.speed;

        // Проверка коллизий
        const isInsideMap = 
            nextX >= 0 && 
            nextY >= 0 && 
            nextX <= game.width - TILE_SIZE && 
            nextY <= game.height - TILE_SIZE;

        if (isInsideMap && canMoveTo(nextX, nextY)) {
            player.x = nextX;
            player.y = nextY;

            // Анимация
            player.frameTimer++;
            if (player.frameTimer > player.animationSpeed) {
                player.frameTimer = 0;
                player.frameIndex = (player.frameIndex === 0) ? 1 : 0;
            }
        }
    } else {
        player.isMoving = false;
    }
}

function draw() {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, game.width, game.height);

    if (!game.isLoaded) return;

    // Рисуем уровень
    if (typeof drawLevel === 'function') {
        drawLevel(ctx, game.sprites, level1);
    }

    // Рисуем игрока
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

// 3. И только В САМОМ КОНЦЕ запускаем загрузку
game.sprites.src = './assets/sprites.png';