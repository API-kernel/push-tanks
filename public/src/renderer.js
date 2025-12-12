import { SPRITES, TILE_SIZE } from './sprites.js';
import { drawRotated } from './client_utils.js';

// --- КАРТА ---

export function drawMapLayers(ctx, spritesImage, levelMap, gameTime) {
    if (!levelMap) return;
    const waterFrame = Math.floor(gameTime / 1000) % 2;

    for (let row = 0; row < levelMap.length; row++) {
        for (let col = 0; col < levelMap[row].length; col++) {
            const block = levelMap[row][col];
            
            if (block === 3) continue; // Лес рисуем позже

            if (typeof block === 'object') {
                const baseSprite = SPRITES.blocks[block.type]; 
                if (!baseSprite) continue;
                const [bx, by] = baseSprite;
                const subSize = 4;
                for (let r = 0; r < 4; r++) {
                    for (let c = 0; c < 4; c++) {
                        if ((block.mask & (1 << (r * 4 + c))) !== 0) {
                            ctx.drawImage(spritesImage, bx + c * subSize, by + r * subSize, subSize, subSize, col * 16 + c * subSize, row * 16 + r * subSize, subSize, subSize);
                        }
                    }
                }
            } else {
                if (block === 4) { // Вода
                    const frames = SPRITES.blocks[4]; 
                    const [sx, sy, sw, sh] = frames[waterFrame];
                    ctx.drawImage(spritesImage, sx, sy, sw, sh, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                } 
                else if (block !== 0) { // Лед и прочее
                    const spriteCoords = SPRITES.blocks[block];
                    if (spriteCoords) {
                        const [sx, sy, sw, sh] = spriteCoords;
                        ctx.drawImage(spritesImage, sx, sy, sw, sh, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                    }
                }
            }
        }
    }
}

export function drawForest(ctx, spritesImage, levelMap) {
    if (!levelMap) return;
    const forestSprite = SPRITES.blocks[3]; 

    for (let row = 0; row < levelMap.length; row++) {
        for (let col = 0; col < levelMap[row].length; col++) {
            const block = levelMap[row][col];
            if (block === 3) {
                const [sx, sy, sw, sh] = forestSprite;
                ctx.drawImage(spritesImage, sx, sy, sw, sh, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }
    }
}

// --- СУЩНОСТИ ---

export function drawBases(ctx, spritesImage, bases) {
    if (!bases) return;
    bases.forEach(base => {
        const baseSprite = base.isDead ? SPRITES.base.dead : SPRITES.base.alive;
        ctx.drawImage(spritesImage, ...baseSprite, base.x, base.y, 16, 16);
    });
}

export function drawBonus(ctx, spritesImage, bonus) {
    if (!bonus) return;
    // Можно добавить мигание, если есть таймер
    const coords = SPRITES.bonuses[bonus.type];
    if (coords) {
        ctx.drawImage(spritesImage, ...coords, bonus.x, bonus.y, 16, 16);
    }
}

export function drawBullets(ctx, spritesImage, bullets) {
    if (!bullets) return;
    bullets.forEach(b => {
        const spriteData = SPRITES.bullet[b.direction];
        if (spriteData) {
            const [sx, sy, w, h] = spriteData;
            // Центрируем
            const dx = Math.floor(b.x + (b.width - w) / 2);
            const dy = Math.floor(b.y + (b.height - h) / 2);
            ctx.drawImage(spritesImage, sx, sy, w, h, dx, dy, w, h);
        }
    });
}

export function drawEnemies(ctx, spritesImage, enemies, pendingSpawns) {

    if (pendingSpawns) {
        pendingSpawns.forEach(s => {
            const idx = s.frameIndex || 0;
            const frame = SPRITES.spawn_appear[idx];
            if (frame) {
                const [sx, sy, sw, sh] = frame;
                ctx.drawImage(spritesImage, sx, sy, sw, sh, s.x, s.y, TILE_SIZE, TILE_SIZE);
            }
        });
    }

    if (enemies) {
        enemies.forEach(enemy => {
            let key = enemy.spriteKey; // 'enemy_basic'
            if (enemy.isBonus) {
                // Мигание каждые 10 кадров (быстро)
                const blink = Math.floor(Date.now() / 150) % 2;
                if (blink === 0) {
                    key += '_red'; // Красная версия
                }
                // Иначе (blink===1) рисуем обычную (белую) версию
            }

            const frames = SPRITES[key] || SPRITES[enemy.spriteKey];
            if (frames) {
                const idx = enemy.frameIndex || 0;
                const frame = frames[idx];
                if (frame) {
                    const [sx, sy, sw, sh] = frame;
                    drawRotated(
                        ctx, spritesImage, 
                        sx, sy, sw, sh, 
                        Math.round(enemy.x), Math.round(enemy.y), TILE_SIZE, TILE_SIZE,
                        enemy.direction
                    );
                }
            }
        });
    }
}

export function drawPlayers(ctx, spritesImage, playersMap) {
    if (!playersMap) return;
    Object.values(playersMap).forEach(p => {
        if (p.isDead) return;

        if (p.isSpawning) {
            // Анимация звездочки (берем таймер с сервера или локальный)
            // Сервер шлет p.spawnAnimTimer (0..60)
            const idx = Math.floor((p.spawnAnimTimer || 0) / 4) % 4;
            const frame = SPRITES.spawn_appear[idx];
            if (frame) {
                const [sx, sy, sw, sh] = frame;
                ctx.drawImage(spritesImage, sx, sy, sw, sh, p.x, p.y, TILE_SIZE, TILE_SIZE);
            }
        } else {
            // Танк
            const lvl = p.level || 1;
            const key = `player_lvl${lvl}`;
            const frames = SPRITES[key] || SPRITES.player_lvl1;

            if (frames) {
                const idx = p.frameIndex || 0;
                const frame = frames[idx];
                if (frame) {
                    const [sx, sy, sw, sh] = frame;
                    drawRotated(
                        ctx, spritesImage,
                        sx, sy, sw, sh,
                        Math.round(p.x), Math.round(p.y), TILE_SIZE, TILE_SIZE,
                        p.direction
                    );
                }
            }
            // Щит
            if (p.shieldTimer > 0) {
                const shieldFrameIndex = Math.floor(Date.now() / 50) % 2;
                const shieldFrame = SPRITES.shield[shieldFrameIndex];
                if (shieldFrame) {
                    const [sx, sy, sw, sh] = shieldFrame;
                    ctx.drawImage(spritesImage, sx, sy, sw, sh, Math.round(p.x), Math.round(p.y), TILE_SIZE, TILE_SIZE);
                }
            }
        }
    });
}

// --- ВЗРЫВЫ (Локальная система частиц) ---

const explosions = [];
export const EXPLOSION_SMALL = 'SMALL';
export const EXPLOSION_BIG = 'BIG';

export function createExplosion(x, y, type = EXPLOSION_SMALL) {
    explosions.push({
        x, y, type,
        frameIndex: 0,
        timer: 0,
        animationSpeed: 4,
        isDead: false
    });
}

export function updateExplosions() {
    for (let i = explosions.length - 1; i >= 0; i--) {
        const boom = explosions[i];
        boom.timer++;
        if (boom.timer > boom.animationSpeed) {
            boom.timer = 0;
            boom.frameIndex++;
            const frames = (boom.type === EXPLOSION_SMALL) 
                ? SPRITES.explosion_small 
                : SPRITES.explosion_big;
            if (boom.frameIndex >= frames.length) {
                boom.isDead = true;
            }
        }
        if (boom.isDead) explosions.splice(i, 1);
    }
}

export function drawExplosions(ctx, spritesImage) {
    explosions.forEach(boom => {
        const frames = (boom.type === EXPLOSION_SMALL) 
                ? SPRITES.explosion_small 
                : SPRITES.explosion_big;
        const frame = frames[boom.frameIndex];
        if (frame) {
            const [sx, sy, sw, sh] = frame;
            ctx.drawImage(
                spritesImage, 
                sx, sy, sw, sh, 
                Math.round(boom.x - sw / 2), Math.round(boom.y - sh / 2), sw, sh
            );
        }
    });
}