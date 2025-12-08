import { TILE_SIZE, SPRITES } from './sprites.js';
import { level1 } from './level.js';
import { createExplosion, EXPLOSION_SMALL } from './explosion.js'; // <--- Импорт

export const bullets = [];

export function createBullet(player) {
    let x = player.x + TILE_SIZE / 2;
    let y = player.y + TILE_SIZE / 2;

    if (player.direction === 'UP') { y -= 8; x -= 2; }
    else if (player.direction === 'DOWN') { y += 8; x -= 2; }
    else if (player.direction === 'LEFT') { x -= 8; y -= 2; }
    else if (player.direction === 'RIGHT') { x += 8; y -= 2; }

    const speed = (player.level >= 2) ? 5 : 3;

    const b = {
        x, y, direction: player.direction, speed, isDead: false,
        owner: 'player1', ownerLevel: player.level || 1,
        width: 4, height: 4
    };

    checkCollisionAndDestroy(b);
    bullets.push(b);
}

export function updateBullets(gameWidth, gameHeight) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];

        if (b.isDead) {
            bullets.splice(i, 1);
            continue;
        }

        const stepSize = 2; 
        const steps = Math.ceil(b.speed / stepSize);
        const stepX = (b.direction === 'LEFT' ? -b.speed : (b.direction === 'RIGHT' ? b.speed : 0)) / steps;
        const stepY = (b.direction === 'UP' ? -b.speed : (b.direction === 'DOWN' ? b.speed : 0)) / steps;

        for (let s = 0; s < steps; s++) {
            b.x += stepX;
            b.y += stepY;

            // --- ИЗМЕНЕНИЕ: Взрыв об край ---
            if (b.x < 0 || b.y < 0 || b.x > gameWidth || b.y > gameHeight) {
                b.isDead = true;
                
                // Рисуем взрыв ровно в точке вылета пули.
                // Не смещаем координаты вручную, padding канваса позволит увидеть взрыв целиком.
                createExplosion(b.x, b.y, EXPLOSION_SMALL);
                break;
            }

            if (checkCollisionAndDestroy(b)) {
                break; 
            }
        }
    }
}

function checkRectIntersection(r1, r2) {
    return (r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y);
}

function checkCollisionAndDestroy(bullet) {
    if (bullet.isDead) return true;

    // --- 1. HIT TEST ---
    let hitDetected = false;
    let isSteelHit = false;
    let contactEdge = (bullet.direction === 'UP' || bullet.direction === 'LEFT') ? -Infinity : Infinity;

    const startCol = Math.floor(bullet.x / TILE_SIZE);
    const endCol   = Math.floor((bullet.x + bullet.width) / TILE_SIZE);
    const startRow = Math.floor(bullet.y / TILE_SIZE);
    const endRow   = Math.floor((bullet.y + bullet.height) / TILE_SIZE);

    const bulletRect = { x: bullet.x, y: bullet.y, w: bullet.width, h: bullet.height };

    for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
            if (row >= 0 && row < level1.length && col >= 0 && col < level1[0].length) {
                let block = level1[row][col];
                if (typeof block !== 'object' || block.mask === 0) continue; 

                for (let r = 0; r < 4; r++) {
                    for (let c = 0; c < 4; c++) {
                        if ((block.mask & (1 << (r * 4 + c))) !== 0) {
                            const subX = col * TILE_SIZE + c * 4;
                            const subY = row * TILE_SIZE + r * 4;
                            const subRect = { x: subX, y: subY, w: 4, h: 4 };

                            if (checkRectIntersection(bulletRect, subRect)) {
                                hitDetected = true;
                                if (block.type === 2) isSteelHit = true;

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

    // УДАР! Создаем эффект
    createExplosion(bullet.x + bullet.width/2, bullet.y + bullet.height/2, EXPLOSION_SMALL);

    bullet.isDead = true;
    if (isSteelHit && bullet.ownerLevel < 4) return true;

    // --- 2. DAMAGE BOX ---
    const cx = bullet.x + bullet.width / 2;
    const cy = bullet.y + bullet.height / 2;
    const lateralSnap = isSteelHit ? 8 : 4;

    let snapX = cx;
    let snapY = cy;

    if (bullet.direction === 'UP' || bullet.direction === 'DOWN') {
        snapX = Math.round(cx / lateralSnap) * lateralSnap; 
    } else {
        snapY = Math.round(cy / lateralSnap) * lateralSnap;
    }

    const spread = 16;
    const depth = (isSteelHit || bullet.ownerLevel >= 4) ? 8 : 4;

    let damageRect = { x: 0, y: 0, w: 0, h: 0 };

    if (bullet.direction === 'UP') {
        damageRect.x = snapX - (spread / 2);
        damageRect.w = spread;
        damageRect.y = contactEdge - depth;
        damageRect.h = depth;
    } else if (bullet.direction === 'DOWN') {
        damageRect.x = snapX - (spread / 2);
        damageRect.w = spread;
        damageRect.y = contactEdge;
        damageRect.h = depth;
    } else if (bullet.direction === 'LEFT') {
        damageRect.y = snapY - (spread / 2);
        damageRect.h = spread;
        damageRect.x = contactEdge - depth;
        damageRect.w = depth;
    } else if (bullet.direction === 'RIGHT') {
        damageRect.y = snapY - (spread / 2);
        damageRect.h = spread;
        damageRect.x = contactEdge;
        damageRect.w = depth;
    }

    // --- 3. APPLY DAMAGE ---
    const dStartCol = Math.floor(damageRect.x / TILE_SIZE);
    const dEndCol   = Math.floor((damageRect.x + damageRect.w) / TILE_SIZE);
    const dStartRow = Math.floor(damageRect.y / TILE_SIZE);
    const dEndRow   = Math.floor((damageRect.y + damageRect.h) / TILE_SIZE);

    for (let row = dStartRow; row <= dEndRow; row++) {
        for (let col = dStartCol; col <= dEndCol; col++) {
            if (row >= 0 && row < level1.length && col >= 0 && col < level1[0].length) {
                let block = level1[row][col];
                
                if (typeof block === 'object' && block.mask > 0) {
                    if (block.type === 2 && bullet.ownerLevel < 4) continue;

                    const blockX = col * TILE_SIZE;
                    const blockY = row * TILE_SIZE;

                    if (block.type === 2) {
                        const quadrants = [
                            { bits: [0,1,4,5],     x: blockX,   y: blockY,   w: 8, h: 8 }, 
                            { bits: [2,3,6,7],     x: blockX+8, y: blockY,   w: 8, h: 8 }, 
                            { bits: [8,9,12,13],   x: blockX,   y: blockY+8, w: 8, h: 8 }, 
                            { bits: [10,11,14,15], x: blockX+8, y: blockY+8, w: 8, h: 8 }  
                        ];
                        for (let q of quadrants) {
                            if (checkRectIntersection(damageRect, q)) {
                                q.bits.forEach(b => block.mask &= ~(1 << b));
                            }
                        }
                    } else {
                        for (let r = 0; r < 4; r++) {
                            for (let c = 0; c < 4; c++) {
                                const bitIndex = r * 4 + c;
                                if ((block.mask & (1 << bitIndex)) !== 0) {
                                    const subRect = { x: blockX + c * 4, y: blockY + r * 4, w: 4, h: 4 };
                                    if (checkRectIntersection(damageRect, subRect)) {
                                        block.mask &= ~(1 << bitIndex);
                                    }
                                }
                            }
                        }
                    }
                    if (block.mask === 0) level1[row][col] = 0;
                }
            }
        }
    }
    return true;
}

export function drawBullets(ctx, spritesImage) {
    bullets.forEach(b => {
        const [sx, sy, w, h] = SPRITES.bullet[b.direction];
        ctx.drawImage(spritesImage, sx, sy, w, h, b.x, b.y, w, h);
    });
}