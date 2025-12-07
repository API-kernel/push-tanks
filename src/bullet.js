// src/bullet.js
import { TILE_SIZE, SPRITES } from './sprites.js';
import { level1 } from './level.js'; // Нам нужен доступ к карте, чтобы ломать её

export const bullets = []; // Массив всех пуль в игре

const BULLET_SPEED = 4; // Скорость пули

// Функция создания пули
export function createBullet(player) {
    // Вычисляем центр танка, чтобы пуля вылетала из дула
    let x = player.x + TILE_SIZE / 2;
    let y = player.y + TILE_SIZE / 2;

    // Корректируем позицию, чтобы вылетала с правильного края
    // И центруем саму пулю (она ~4px)
    if (player.direction === 'UP') {
        y -= 8; x -= 2;
    } else if (player.direction === 'DOWN') {
        y += 8; x -= 2;
    } else if (player.direction === 'LEFT') {
        x -= 8; y -= 2;
    } else if (player.direction === 'RIGHT') {
        x += 8; y -= 2;
    }

    bullets.push({
        x: x,
        y: y,
        direction: player.direction,
        isDead: false, // Флаг для удаления
        owner: 'player1' // На будущее для мультиплеера
    });
}

// Обновление пуль (движение и коллизии)
export function updateBullets(gameWidth, gameHeight) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];

        // 1. Движение
        if (b.direction === 'UP') b.y -= BULLET_SPEED;
        else if (b.direction === 'DOWN') b.y += BULLET_SPEED;
        else if (b.direction === 'LEFT') b.x -= BULLET_SPEED;
        else if (b.direction === 'RIGHT') b.x += BULLET_SPEED;

        // 2. Вылет за границы экрана
        if (b.x < 0 || b.y < 0 || b.x > gameWidth || b.y > gameHeight) {
            b.isDead = true;
        }

        // 3. Попадание в стены
        // Проверяем центр пули
        checkWallCollision(b);

        // Если пуля умерла - удаляем из массива
        if (b.isDead) {
            bullets.splice(i, 1);
        }
    }
}

function checkWallCollision(bullet) {
    // Находим координаты клетки на карте
    // +2 чтобы брать центр пули (размер 4px)
    const col = Math.floor((bullet.x + 2) / TILE_SIZE);
    const row = Math.floor((bullet.y + 2) / TILE_SIZE);

    // Проверка границ массива
    if (row >= 0 && row < level1.length && col >= 0 && col < level1[0].length) {
        const block = level1[row][col];

        // 1 = Кирпич (разрушаемый)
        if (block === 1) {
            level1[row][col] = 0; // Ломаем стену! (превращаем в пустоту)
            bullet.isDead = true; // Пуля исчезает
        }
        // 2 = Бетон (неразрушаемый)
        else if (block === 2) {
            bullet.isDead = true; // Пуля исчезает, стена стоит
        }
        // Вода (4), Лес (3), Лед (5) пулю пропускают
    }
}

// Отрисовка пуль
export function drawBullets(ctx, spritesImage) {
    bullets.forEach(b => {
        const [sx, sy, w, h] = SPRITES.bullet[b.direction];
        ctx.drawImage(spritesImage, sx, sy, w, h, b.x, b.y, w, h);
    });
}