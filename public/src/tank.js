import { TILE_SIZE, SPRITES } from './sprites.js';
import { canMoveTo } from './physics.js';
import { drawRotated } from './utils.js';

/**
 * Общая логика движения для любого танка (Игрок или Бот).
 * Возвращает true, если движение удалось, и false, если уперлись.
 */
export function updateTankMovement(tank, direction, gameWidth, gameHeight, onCheckCollision) {
    if (!direction) {
        tank.isMoving = false;
        return false;
    }

    // Запоминаем направление
    tank.direction = direction;
    tank.isMoving = true;

    // Рассчитываем новую позицию
    let nextX = tank.x;
    let nextY = tank.y;

    if (direction === 'UP') nextY -= tank.speed;
    else if (direction === 'DOWN') nextY += tank.speed;
    else if (direction === 'LEFT') nextX -= tank.speed;
    else if (direction === 'RIGHT') nextX += tank.speed;

    // 1. Проверка Границ Карты
    const isInsideMap =
        nextX >= 0 && nextY >= 0 &&
        nextX <= gameWidth - TILE_SIZE && nextY <= gameHeight - TILE_SIZE;

    if (!isInsideMap) {
        tank.isMoving = false;
        return false;
    }

    // 2. Проверка Стен (canMoveTo)
    if (!canMoveTo(nextX, nextY)) {
        tank.isMoving = false;
        return false;
    }

    // 3. Проверка Других Танков (Smart Collision)
    // Передаем (nextX, nextY) - куда хотим, и (tank.x, tank.y) - где мы сейчас.
    // Если onCheckCollision вернет true — значит место занято.
    if (onCheckCollision(nextX, nextY, tank.x, tank.y, tank.id)) {
        tank.isMoving = false;
        return false;
    }

    // ДВИЖЕНИЕ РАЗРЕШЕНО
    tank.x = nextX;
    tank.y = nextY;

    // Анимация гусениц
    tank.frameTimer++;
    // Быстрые танки перебирают гусеницами быстрее
    const animThreshold = (tank.speed > 0.8) ? 4 : 8;

    if (tank.frameTimer > animThreshold) {
        tank.frameTimer = 0;
        // Переключаем кадр 0 <-> 1
        tank.frameIndex = (tank.frameIndex === 0) ? 1 : 0;
    }

    return true;
}

/**
 * Общая отрисовка танка с учетом поворота и щита.
 */
export function drawTank(ctx, spritesImage, tank) {
    // Определяем ключ спрайта.
    // У врагов это поле 'spriteKey' (например 'enemy_basic').
    // У игрока такого поля нет, по умолчанию 'player'.
    const key = tank.spriteKey || 'player';
    
    // Получаем массив кадров [frame1, frame2] (смотрят ВВЕРХ)
    const frames = SPRITES[key];

    if (!frames) return;

    const frame = frames[tank.frameIndex];
    if (frame) {
        const [sx, sy, sw, sh] = frame;

        // Рисуем с программным поворотом (из utils.js)
        drawRotated(
            ctx,
            spritesImage,
            sx, sy, sw, sh,
            Math.round(tank.x), Math.round(tank.y), TILE_SIZE, TILE_SIZE,
            tank.direction
        );
    }

    // Отрисовка Щита (Shield) поверх танка
    if (tank.shieldTimer > 0) {
        // Мигание щита (смена кадров каждые 50мс)
        const shieldFrameIndex = Math.floor(Date.now() / 50) % 2;
        const shieldFrame = SPRITES.shield[shieldFrameIndex];
        
        if (shieldFrame) {
            const [sx, sy, sw, sh] = shieldFrame;
            // Щит круглый, его крутить не надо
            ctx.drawImage(
                spritesImage, 
                sx, sy, sw, sh, 
                Math.round(tank.x), Math.round(tank.y), TILE_SIZE, TILE_SIZE
            );
        }
    }
}