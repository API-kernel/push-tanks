import { TILE_SIZE } from '../shared/config.js';
import { canMoveTo } from './physics.js';

export function updateTankMovement(tank, direction, gameWidth, gameHeight, onCheckCollision) {
    if (!direction) {
        tank.isMoving = false;
        return false;
    }

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
        return false;
    }

    if (!canMoveTo(nextX, nextY)) {
        tank.isMoving = false;
        return false;
    }

    if (onCheckCollision(nextX, nextY, tank.x, tank.y, tank.id)) {
        tank.isMoving = false;
        return false;
    }

    tank.x = nextX;
    tank.y = nextY;

    // Анимация (серверу она не нужна для физики, но пусть считает кадры, чтобы синхронизировать их)
    tank.frameTimer++;
    const animThreshold = (tank.speed > 0.8) ? 4 : 8;
    if (tank.frameTimer > animThreshold) {
        tank.frameTimer = 0;
        tank.frameIndex = (tank.frameIndex === 0) ? 1 : 0;
    }

    return true;
}