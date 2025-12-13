import { TILE_SIZE } from './config.js';

export const bullets = [];

export function createBullet(shooter, bulletsList, map) {
    let x = shooter.x + TILE_SIZE / 2;
    let y = shooter.y + TILE_SIZE / 2;

    if (shooter.direction === 'UP') { y -= 8; x -= 2; }
    else if (shooter.direction === 'DOWN') { y += 8; x -= 2; }
    else if (shooter.direction === 'LEFT') { x -= 8; y -= 2; }
    else if (shooter.direction === 'RIGHT') { x += 8; y -= 2; }

    const speed = (shooter.level >= 2) ? 5 : 3;

    const b = {
        x, y, 
        direction: shooter.direction, 
        speed, 
        isDead: false,
        ownerId: shooter.id, 
        team: shooter.team,
        ownerLevel: shooter.level || 1,
        width: 4, height: 4
    };

    bulletsList.push(b);
}

export function updateBullets(bulletsList, map, gameWidth, gameHeight) {
    const events = [];

    for (let i = bulletsList.length - 1; i >= 0; i--) {
        const b = bulletsList[i];

        if (b.isDead) {
            bulletsList.splice(i, 1);
            continue;
        }

        const stepSize = 2; 
        const steps = Math.ceil(b.speed / stepSize);
        const stepX = (b.direction === 'LEFT' ? -b.speed : (b.direction === 'RIGHT' ? b.speed : 0)) / steps;
        const stepY = (b.direction === 'UP' ? -b.speed : (b.direction === 'DOWN' ? b.speed : 0)) / steps;

        for (let s = 0; s < steps; s++) {
            // Проверка перед шагом
            let collisionResult = checkCollisionAndDestroy(b, map);
            if (collisionResult) {
                events.push({ 
                    type: 'HIT', 
                    x: b.x, y: b.y, 
                    ownerId: b.ownerId,
                    isSteel: collisionResult === 'STEEL',
                    isSteelNoDmg: collisionResult === 'STEEL_NO_DMG',
                    level: b.ownerLevel
                });
                break; 
            }

            b.x += stepX;
            b.y += stepY;

            if (b.x < 0 || b.y < 0 || b.x > gameWidth || b.y > gameHeight) {
                b.isDead = true;
                events.push({ type: 'WALL_HIT', x: b.x, y: b.y, ownerId: b.ownerId });
                break;
            }
        }
    }
    
    return events;
}

function checkRectIntersection(r1, r2) {
    return (r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y);
}

function checkCollisionAndDestroy(bullet, map) {
    if (bullet.isDead) return false;

    let hitDetected = false;
    let isSteelHit = false;
    let contactEdge = (bullet.direction === 'UP' || bullet.direction === 'LEFT') ? -Infinity : Infinity;

    const startCol = Math.floor(bullet.x / TILE_SIZE);
    const endCol   = Math.floor((bullet.x + bullet.width) / TILE_SIZE);
    const startRow = Math.floor(bullet.y / TILE_SIZE);
    const endRow   = Math.floor((bullet.y + bullet.height) / TILE_SIZE);

    const bulletRect = { x: bullet.x, y: bullet.y, w: bullet.width, h: bullet.height };

    // 1. HIT TEST (Ищем контакт)
    for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
            if (row >= 0 && row < map.length && col >= 0 && col < map[0].length) {
                let block = map[row][col];
                if (typeof block !== 'object' || block.mask === 0) continue; 

                for (let r = 0; r < 2; r++) {
                    for (let c = 0; c < 2; c++) {
                        if ((block.mask & (1 << (r * 2 + c))) !== 0) {
                            const subX = col * TILE_SIZE + c * 4;
                            const subY = row * TILE_SIZE + r * 4;
                            const subRect = { x: subX, y: subY, w: 4, h: 4 };

                            if (checkRectIntersection(bulletRect, subRect)) {
                                hitDetected = true;
                                if (block.type === 2) isSteelHit = true;

                                // Находим грань стены (Contact Edge)
                                if (bullet.direction === 'UP') {
                                    if (subY + 4 > contactEdge) contactEdge = subY + 4;
                                } else if (bullet.direction === 'DOWN') {
                                    if (subY < contactEdge) contactEdge = subY;
                                } else if (bullet.direction === 'LEFT') {
                                    if (subX + 4 > contactEdge) contactEdge = subX + 4;
                                } else if (bullet.direction === 'RIGHT') {
                                    if (subX < contactEdge) contactEdge = subX;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (!hitDetected) return false;

    // FRIENDLY FIRE
    if (bullet.ownerId >= 1000) {
        const bRow = Math.floor(bullet.y / TILE_SIZE);
        const bCol = Math.floor(bullet.x / TILE_SIZE);
        // Координаты защиты базы для карты 26x26
        if (bullet.team === 2 && bRow <= 3 && bCol >= 10 && bCol <= 15) {
            bullet.isDead = true; 
            return 'FRIENDLY_WALL'; 
        }
        if (bullet.team === 1 && bRow >= 22 && bCol >= 10 && bCol <= 15) {
            bullet.isDead = true;
            return 'FRIENDLY_WALL'; 
        }
    }

    bullet.isDead = true;
    if (isSteelHit && bullet.ownerLevel < 4) return 'STEEL_NO_DMG';

    // 2. APPLY DAMAGE (ИНДЕКСНЫЙ МЕТОД)
    
    const cx = bullet.x + bullet.width / 2;
    const cy = bullet.y + bullet.height / 2;
    
    // Snap to 8px grid (Центр коридора 16px)
    const snapX = Math.round(cx / 8) * 8;
    let snapY = Math.round(cy / 8) * 8;
    
    const spread = 16;
    const depth = (isSteelHit || bullet.ownerLevel >= 4) ? 8 : 4;
    
    // Вычисляем координаты уничтожаемой области
    let areaL, areaR, areaT, areaB; // Границы (Left, Right, Top, Bottom)

    if (bullet.direction === 'UP') {
        areaL = snapX - spread/2;
        areaR = snapX + spread/2;
        areaT = contactEdge - depth;
        areaB = contactEdge;
    } else if (bullet.direction === 'DOWN') {
        areaL = snapX - spread/2;
        areaR = snapX + spread/2;
        areaT = contactEdge;
        areaB = contactEdge + depth;
    } else if (bullet.direction === 'LEFT') {
        // Для горизонтали снеппинг по Y
        snapY = Math.round(cy / 8) * 8;
        areaT = snapY - spread/2;
        areaB = snapY + spread/2;
        areaL = contactEdge - depth;
        areaR = contactEdge;
    } else if (bullet.direction === 'RIGHT') {
        snapY = Math.round(cy / 8) * 8;
        areaT = snapY - spread/2;
        areaB = snapY + spread/2;
        areaL = contactEdge;
        areaR = contactEdge + depth;
    }

    // Переводим пиксельные координаты области в индексы микро-блоков
    // Микро-блоки идут с шагом 4px
    
    // Для надежности берем центр микро-блока (координата + 2)
    // Проходимся по сетке 4px внутри области
    for (let y = areaT; y < areaB; y += 4) {
        for (let x = areaL; x < areaR; x += 4) {
            
            // Координаты центра микро-блока, который хотим удалить
            const targetX = x + 2;
            const targetY = y + 2;
            
            const col = Math.floor(targetX / TILE_SIZE);
            const row = Math.floor(targetY / TILE_SIZE);
            
            // Проверка границ карты
            if (row >= 0 && row < map.length && col >= 0 && col < map[0].length) {
                let block = map[row][col];
                
                if (typeof block === 'object' && block.mask > 0) {
                    // Бетон ломаем только мощным танком
                    if (block.type === 2 && bullet.ownerLevel < 4) continue;
                    
                    // Вычисляем индекс микро-блока внутри тайла (0..3)
                    const localX = Math.floor((targetX % TILE_SIZE) / 4);
                    const localY = Math.floor((targetY % TILE_SIZE) / 4);
                    const bitIndex = localY * 2 + localX;
                    
                    // Выключаем бит
                    block.mask &= ~(1 << bitIndex);
                    
                    // Если блок пуст - удаляем
                    if (block.mask === 0) map[row][col] = 0;
                }
            }
        }
    }

    return isSteelHit ? 'STEEL' : 'BRICK';
}