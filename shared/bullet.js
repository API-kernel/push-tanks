import { TILE_SIZE, TILE_BIG_SIZE } from './config.js';

export function createBullet(shooter, speed) {
    // Центр тайла = 8. Визуальный центр танка ~7 (из-за отступов 1px и 2px).
    // Сдвигаем точку спавна на -1.
    const OFFSET = 1;

    let x = shooter.x + TILE_BIG_SIZE / 2 - OFFSET; // 8 - 1 = 7
    let y = shooter.y + TILE_BIG_SIZE / 2 - OFFSET; // 8 - 1 = 7

    // Пуля 4x4. Её центр - это +2.
    // Нам нужно, чтобы (x + 2) было ровно на дуле.
    // Дуло находится по центру стороны.
    
    // Корректировка, чтобы пуля вылетала из края тайла
    if (shooter.direction === 'UP') { 
        y -= TILE_BIG_SIZE / 2; // Край
        x -= OFFSET; // Центруем пулю (4px) относительно оси (7) -> 5. 
        // Итог: x=5 (центр пули 7), y=-1.
    }
    else if (shooter.direction === 'DOWN') { 
        y += TILE_BIG_SIZE / 2; 
        x -= OFFSET; 
    }
    else if (shooter.direction === 'LEFT') { 
        x -= TILE_BIG_SIZE / 2; 
    }
    else if (shooter.direction === 'RIGHT') { 
        x += TILE_BIG_SIZE / 2; 
    }

    return {
        x, y, 
        direction: shooter.direction, 
        speed,
        dist: 0, 
        isDead: false,
        ownerId: shooter.id, 
        team: shooter.team,
        ownerLevel: shooter.level || 1,
        width: 4, height: 4
    };
}

export function updateBullets(bulletsList, map, gameWidth, gameHeight, teamManager, vibraniumEnabled) {
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
            let collisionResult = checkCollisionAndDestroy(b, map, teamManager, vibraniumEnabled);
            if (collisionResult) {
                if (collisionResult === 'VIBRANIUM_PING') {
                    b.isDead = true;
                    events.push({ 
                        type: 'ARMOR_HIT',
                        x: b.x, y: b.y, 
                        ownerId: b.ownerId 
                    });
                } 
                else {
                    events.push({ 
                        type: 'HIT', 
                        x: b.x, y: b.y, 
                        ownerId: b.ownerId,
                        isSteel: collisionResult === 'STEEL',
                        isSteelNoDmg: collisionResult === 'STEEL_NO_DMG',
                        level: b.ownerLevel
                    });
                }
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

function checkCollisionAndDestroy(bullet, map, teamManager, vibraniumEnabled) {
    if (bullet.isDead) return false;

    let hitDetected = false;
    let isSteelHit = false;
    let hitBlock = null;
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
                if (block.type !== 1 && block.type !== 2) continue;
                if (block.mask === 0) continue;
                
                for (let r = 0; r < 2; r++) {
                    for (let c = 0; c < 2; c++) {
                        if ((block.mask & (1 << (r * 2 + c))) !== 0) {
                            const subX = col * TILE_SIZE + c * 4;
                            const subY = row * TILE_SIZE + r * 4;
                            const subRect = { x: subX, y: subY, w: 4, h: 4 };

                            if (checkRectIntersection(bulletRect, subRect)) {
                                hitDetected = true;
                                hitBlock = block;
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
        
        // Спрашиваем у менеджера: это моя база?
        if (teamManager.isInBaseZone(bullet.team, bRow, bCol)) {
            bullet.isDead = true;
            return 'FRIENDLY_WALL'; 
        }
    }

    bullet.isDead = true;

    if (vibraniumEnabled && hitBlock && hitBlock.isBaseWall) {
        if (Math.random() > 0.1) {
            return 'VIBRANIUM_PING'; 
        }
    }

    if (isSteelHit && bullet.ownerLevel < 4) return 'STEEL_NO_DMG';

    // 2. DISCRETE DESTRUCTION (Дискретное разрушение)
    // Мы не используем прямоугольники, мы вычисляем индексы точек для удаления.
    
    const cx = bullet.x + bullet.width / 2;
    const cy = bullet.y + bullet.height / 2;

    // Настраиваем привязку. 4px для кирпича, 8px для бетона.
    const snapSize = isSteelHit ? 8 : 4;
    
    let startX, startY, widthX, widthY;
    const spread = 16; // Ширина
    const depth = (isSteelHit || bullet.ownerLevel >= 4) ? 8 : 4; // Глубина

    if (bullet.direction === 'UP') {
        const snapX = Math.round(cx / snapSize) * snapSize;
        startX = snapX - (spread / 2);
        widthX = spread;
        
        // По Y идем от грани вверх
        startY = contactEdge - depth; 
        widthY = depth;
        
    } else if (bullet.direction === 'DOWN') {
        const snapX = Math.round(cx / snapSize) * snapSize;
        startX = snapX - (spread / 2);
        widthX = spread;
        
        startY = contactEdge; // От грани вниз
        widthY = depth;

    } else if (bullet.direction === 'LEFT') {
        const snapY = Math.round(cy / snapSize) * snapSize;
        startY = snapY - (spread / 2);
        widthY = spread;
        
        startX = contactEdge - depth;
        widthX = depth;

    } else if (bullet.direction === 'RIGHT') {
        const snapY = Math.round(cy / snapSize) * snapSize;
        startY = snapY - (spread / 2);
        widthY = spread;
        
        startX = contactEdge;
        widthX = depth;
    }

    // ТЕПЕРЬ САМОЕ ВАЖНОЕ: Проходимся шагами по 4px
    // И удаляем микро-блоки, центр которых попадает в эти точки.
    // Добавляем +2 (половина 4px), чтобы брать центр микро-блока.

    for (let dy = 0; dy < widthY; dy += 4) {
        for (let dx = 0; dx < widthX; dx += 4) {
            
            const targetX = startX + dx + 2;
            const targetY = startY + dy + 2;

            const col = Math.floor(targetX / TILE_SIZE);
            const row = Math.floor(targetY / TILE_SIZE);

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