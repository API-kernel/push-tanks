import { TILE_SIZE, TILE_BIG_SIZE, SERVER_FPS, TANK_SNAP_GRID, TANK_SNAP_TOLERANCE } from './config.js';
import { canMoveTo } from './physics.js';

export function updateTankMovement(tank, direction, gameWidth, gameHeight, map, onCheckCollision) {
    // --- ЛЕД ---
    const cx = Math.floor((tank.x + TILE_SIZE) / TILE_SIZE);
    const cy = Math.floor((tank.y + TILE_SIZE) / TILE_SIZE);
    // Проверка границ массива
    let isOnIce = false;
    if (map && map[cy] && map[cy][cx].type === 5) isOnIce = true;

    // ИНЕРЦИЯ
    if (!direction && isOnIce && tank.slideTimer > 0) {
        direction = tank.lastDirection;
        tank.slideTimer--;
    } else if (direction) {
        tank.slideTimer = 0.5 * SERVER_FPS; // Заряжаем инерцию
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
        nextX <= gameWidth - TILE_BIG_SIZE && 
        nextY <= gameHeight - TILE_BIG_SIZE;  

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

    // Анимация
    tank.frameTimer++;
    const animThreshold = (tank.speed > 0.8) ? 4 : 8;
    if (tank.frameTimer > animThreshold) {
        tank.frameTimer = 0;
        tank.frameIndex = (tank.frameIndex === 0) ? 1 : 0;
    }

    // --- GRID ASSIST
    const axis = (direction === 'UP' || direction === 'DOWN') ? 'x' : 'y';
    
    // Центр танка по оси выравнивания
    const center = tank[axis] + TILE_BIG_SIZE / 2; 
    
    const nearestGrid = Math.round(center / TANK_SNAP_GRID) * TANK_SNAP_GRID;
    const diff = nearestGrid - center;

    // Если мы не на сетке, но близко к ней
    if (Math.abs(diff) > 0 && Math.abs(diff) < TANK_SNAP_TOLERANCE) {
        
        // Пытаемся сдвинуться перпендикулярно движению
        const snapX = (axis === 'x') ? tank.x + Math.sign(diff) : tank.x;
        const snapY = (axis === 'y') ? tank.y + Math.sign(diff) : tank.y;
        
        // Проверяем, не врежемся ли мы при сдвиге
        // (Используем ту же функцию canMoveTo и onCheckCollision, что и для основного движения)
        const canShiftMap = canMoveTo(snapX, snapY, map);
        const canShiftTank = !onCheckCollision(snapX, snapY, tank.x, tank.y, tank.id);
        
        if (canShiftMap && canShiftTank) {
            // Двигаем танк к сетке
            // Скорость выравнивания = 1 пиксель за кадр (или меньше, если diff < 1)
            const shiftAmount = Math.sign(diff) * Math.min(Math.abs(diff), 1);
            
            if (axis === 'x') tank.x += shiftAmount; 
            else tank.y += shiftAmount;
        }
    }

    return true;
}