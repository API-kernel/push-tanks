import { TILE_SIZE, TILE_BIG_SIZE, SERVER_FPS, TANK_SMART_ALIGN_RANGE, TANK_SMART_ALIGN_SPEED } from './config.js';
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

    // 2. Проверка физики стен + SMART ALIGN (Ассистент вписывания)
    let moveAllowed = canMoveTo(nextX, nextY, map);

    if (!moveAllowed) {
        // Мы врезались. Попробуем найти проход рядом.
        
        // Определяем ось скольжения (перпендикулярно движению)
        const axis = (direction === 'UP' || direction === 'DOWN') ? 'x' : 'y';
        
        // В какую сторону искать? (Сначала ищем ближайший "центр клетки")
        // Центр танка
        const center = tank[axis] + TILE_BIG_SIZE / 2;
        // Ближайшая сетка 16px (размер прохода обычно 16 или 8)
        const snapGrid = 8; // Сетка карты
        const nearest = Math.round(center / snapGrid) * snapGrid;
        const diff = nearest - center; // Куда нам надо сдвинуться (-4..+4)

        // Мы пробуем сдвинуться в сторону nearest, но если там занято, то пробуем в другую.
        // Но проще перебрать диапазон.
        
        let slipFound = false;
        
        // Проверяем сдвиги в диапазоне от 1px до LIMIT
        // Приоритет отдаем той стороне, куда мы ближе (diff)
        const checkOrder = diff > 0 ? [1, -1] : [-1, 1];
        
        for (let offset = 1; offset <= TANK_SMART_ALIGN_RANGE; offset++) {
            for (let sign of checkOrder) {
                const shift = offset * sign;
                
                // Проверяем: если мы сдвинемся перпендикулярно, сможем ли мы ехать вперед?
                let tryX = nextX;
                let tryY = nextY;
                
                if (axis === 'x') tryX += shift;
                else tryY += shift;

                if (canMoveTo(tryX, tryY, map)) {
                    // УРА! Нашли проход.
                    // Теперь двигаем танк не вперед, а В СТОРОНУ прохода.
                    // Скорость бокового скольжения
                    const slideSpeed = tank.speed * TANK_SMART_ALIGN_SPEED;
                    const realShift = Math.sign(shift) * Math.min(Math.abs(shift), slideSpeed);
                    
                    if (axis === 'x') tank.x += realShift;
                    else tank.y += realShift;
                    
                    slipFound = true;
                    // Мы не двигаемся вперед в этом кадре (или двигаемся совсем чуть-чуть), 
                    // мы "соскальзываем" в дырку. В следующем кадре мы уже попадем в canMoveTo.
                    break;
                }
            }
            if (slipFound) break;
        }

        if (!slipFound) {
            tank.isMoving = false;
            tank.slideTimer = 0;
            return false;
        }
    } else {
        // 3. Проверка коллизий с сущностями (Танками/Базой)
        // (Делаем только если стена не мешает)
        if (onCheckCollision(nextX, nextY, tank.x, tank.y, tank.id)) {
            tank.isMoving = false;
            tank.slideTimer = 0;
            return false;
        }

        // Если все ок - едем
        tank.x = nextX;
        tank.y = nextY;
    }

    tank.x = Math.max(0, Math.min(tank.x, gameWidth - TILE_BIG_SIZE));
    tank.y = Math.max(0, Math.min(tank.y, gameHeight - TILE_BIG_SIZE));

    return true;
}