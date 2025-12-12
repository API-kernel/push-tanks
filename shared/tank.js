import { TILE_SIZE } from './config.js';
import { canMoveTo } from './physics.js';

export function updateTankMovement(tank, direction, gameWidth, gameHeight, map, onCheckCollision) {
    // --- ЛЕД ---
    const cx = Math.floor((tank.x + 8) / 16);
    const cy = Math.floor((tank.y + 8) / 16);
    // Проверка границ массива
    let isOnIce = false;
    if (map && map[cy] && map[cy][cx] === 5) isOnIce = true;

    // ИНЕРЦИЯ
    if (!direction && isOnIce && tank.slideTimer > 0) {
        direction = tank.lastDirection;
        tank.slideTimer--;
    } else if (direction) {
        tank.slideTimer = 32; // Заряжаем инерцию
        tank.lastDirection = direction;
    } else {
        tank.slideTimer = 0;
    }

    // ЕСЛИ ВСЁ ЕЩЕ НЕТ НАПРАВЛЕНИЯ -> СТОП
    if (!direction) {
        tank.isMoving = false;
        return false;
    }

    // ДВИЖЕНИЕ
    tank.direction = direction;
    tank.isMoving = true;

    let nextX = tank.x;
    let nextY = tank.y;

    if (direction === 'UP') nextY -= tank.speed;
    else if (direction === 'DOWN') nextY += tank.speed;
    else if (direction === 'LEFT') nextX -= tank.speed;
    else if (direction === 'RIGHT') nextX += tank.speed;

    const isInsideMap =
        nextX >= 0 && nextY >= 0 &&
        nextX <= gameWidth - TILE_SIZE && nextY <= gameHeight - TILE_SIZE;

    if (!isInsideMap) {
        tank.isMoving = false;
        tank.slideTimer = 0; // Стоп
        return false;
    }

    if (!canMoveTo(nextX, nextY, map)) {
        tank.isMoving = false;
        tank.slideTimer = 0; // Стоп
        return false;
    }

    if (onCheckCollision(nextX, nextY, tank.x, tank.y, tank.id)) {
        tank.isMoving = false;
        tank.slideTimer = 0; // Стоп
        return false;
    }

    tank.x = nextX;
    tank.y = nextY;

    // --- GRID ASSIST (Выравнивание 4px) ---
    const axis = (direction === 'UP' || direction === 'DOWN') ? 'x' : 'y';
    const center = tank[axis] + TILE_SIZE / 2;
    const snapSize = 4;
    const nearestGrid = Math.round(center / snapSize) * snapSize;
    const diff = nearestGrid - center;

    if (Math.abs(diff) > 0 && Math.abs(diff) < 3) {
        const snapX = (axis === 'x') ? nearestGrid - TILE_SIZE/2 : tank.x;
        const snapY = (axis === 'y') ? nearestGrid - TILE_SIZE/2 : tank.y;
        
        if (canMoveTo(snapX, snapY, map) && !onCheckCollision(snapX, snapY, tank.x, tank.y, tank.id)) {
            if (axis === 'x') tank.x += Math.sign(diff); 
            else tank.y += Math.sign(diff);
        }
    }

    // Анимация
    tank.frameTimer++;
    const animThreshold = (tank.speed > 0.8) ? 4 : 8;
    if (tank.frameTimer > animThreshold) {
        tank.frameTimer = 0;
        tank.frameIndex = (tank.frameIndex === 0) ? 1 : 0;
    }

    return true;
}