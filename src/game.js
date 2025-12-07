import { SPRITES, TILE_SIZE } from './sprites.js';
import { InputHandler } from './input.js';
// Если ты еще не создал level.js, закомментируй строку ниже и вызов drawLevel в функции draw!
import { level1, drawLevel } from './level.js'; 

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
    x: 100,
    y: 100,
    speed: 1,
    direction: 'UP',
    isMoving: false,
    frameIndex: 0,
    frameTimer: 0,
    animationSpeed: 8
};

game.sprites.src = './assets/sprites.png';

game.sprites.onload = () => {
    console.log("Картинка загружена, старт!");
    game.isLoaded = true;
    requestAnimationFrame(loop);
};

// Если картинка не найдена, покажет ошибку
game.sprites.onerror = () => {
    console.error("ОШИБКА: Не удалось загрузить ./assets/sprites.png");
};

function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

function update() {
    const direction = game.input.getDirection();

    if (direction) {
        player.isMoving = true;
        player.direction = direction;

        if (direction === 'UP') player.y -= player.speed;
        else if (direction === 'DOWN') player.y += player.speed;
        else if (direction === 'LEFT') player.x -= player.speed;
        else if (direction === 'RIGHT') player.x += player.speed;

        // Анимация
        player.frameTimer++;
        if (player.frameTimer > player.animationSpeed) {
            player.frameTimer = 0;
            // Переключаем 0 -> 1 -> 0
            player.frameIndex = (player.frameIndex === 0) ? 1 : 0;
        }
    } else {
        player.isMoving = false;
        // Если хочешь, чтобы гусеницы замирали, когда стоишь:
        // player.frameIndex = 0; 
    }

    // Границы
    if (player.x < 0) player.x = 0;
    if (player.y < 0) player.y = 0;
    if (player.x > game.width - TILE_SIZE) player.x = game.width - TILE_SIZE;
    if (player.y > game.height - TILE_SIZE) player.y = game.height - TILE_SIZE;
}

function draw() {
    // 1. Очистка
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, game.width, game.height);

    if (!game.isLoaded) return;

    // 2. Рисуем карту (если есть level.js)
    if (typeof drawLevel === 'function') {
        drawLevel(ctx, game.sprites, level1);
    }

    // 3. Рисуем игрока
    const dirData = SPRITES.player[player.direction];
    
    // Защита от ошибок (если вдруг направление кривое)
    if (dirData) {
        // Берем кадр по индексу
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