console.log("Загрузка game.js...");

import { SPRITES, TILE_SIZE } from './sprites.js';
import { InputHandler } from './input.js';
import { level1, drawLevel, initLevel } from './level.js';
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
    bulletCooldown: 0,
    level: 1 // <--- НОВОЕ: Уровень танка (1 - слабый, 4 - ломает бетон)
};

game.sprites.onload = () => {
    console.log("Картинка загружена, старт!");
    game.isLoaded = true;
    requestAnimationFrame(loop);
};

game.sprites.onerror = () => {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: Картинка ./assets/sprites.png не найдена!");
};

game.sprites.onload = () => {
    console.log("Картинка загружена, старт!");
    initLevel();
    game.isLoaded = true;
    requestAnimationFrame(loop);
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
    // --- ЧИТЫ (Для теста уровней) ---
    // Нажимай цифры на клавиатуре, чтобы менять прокачку
    if (game.input.keys['Digit1']) { player.level = 1; console.log("Lvl 1: Basic"); }
    if (game.input.keys['Digit2']) { player.level = 2; console.log("Lvl 2: Speed"); }
    if (game.input.keys['Digit3']) { player.level = 3; console.log("Lvl 3: Double Shot"); }
    if (game.input.keys['Digit4']) { player.level = 4; console.log("Lvl 4: Concrete"); }

    // --- Движение ---
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
            nextX >= 0 && 
            nextY >= 0 && 
            nextX <= game.width - TILE_SIZE && 
            nextY <= game.height - TILE_SIZE;

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

    // --- Стрельба ---
    if (player.bulletCooldown > 0) {
        player.bulletCooldown--;
    }

    if (game.input.keys['Space']) {
        // Определяем макс. кол-во пуль
        // Если уровень >= 3, можно 2 пули. Иначе 1.
        const maxBullets = (player.level >= 3) ? 2 : 1;

        if (player.bulletCooldown === 0 && bullets.length < maxBullets) {
            createBullet(player);
            // Если быстрые пули (Lvl 2+), стреляем чуть чаще (15 кадров), иначе медленнее (25)
            player.bulletCooldown = (player.level >= 2) ? 15 : 25; 
        }
    }

    updateBullets(game.width, game.height);
}

function draw() {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, game.width, game.height);

    if (!game.isLoaded) return;

    if (typeof drawLevel === 'function') {
        drawLevel(ctx, game.sprites, level1);
    }

    drawBullets(ctx, game.sprites);

    // В будущем тут можно менять спрайт танка в зависимости от player.level
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

game.sprites.src = './assets/sprites.png';