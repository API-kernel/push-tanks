import { SPRITES } from './sprites.js';
import { TILE_SIZE, TILE_BIG_SIZE } from '../shared/config.js';
import { drawRotated } from './client_utils.js';

const animCache = {}; // { id: { frame: 0, timer: 0 } }

// --- КАРТА ---

export function drawMapLayers(ctx, spritesImage, levelMap, gameTime) {
    if (!levelMap) return;
    const waterFrame = Math.floor(gameTime / 1000) % 2;

    const SUB_SIZE = 4; // Размер микро-блока

    for (let row = 0; row < levelMap.length; row++) {
        for (let col = 0; col < levelMap[row].length; col++) {
            const block = levelMap[row][col];
            
            if (block.type === 0) continue;
            if (block.type === 3) continue;

            if (block.type === 1 || block.type === 2) {
                const baseSprite = SPRITES.blocks[block.type]; 
                if (!baseSprite) continue;
                // Вычисляем смещение текстуры
                const texOffX = (col % 2) * 8;
                const texOffY = (row % 2) * 8;
                
                const [bx, by] = baseSprite;
                
                // Рисуем 4 микро-блока (2x2)
                for (let r = 0; r < 2; r++) {
                    for (let c = 0; c < 2; c++) {
                        // Маска 4 бита: 0, 1 (верх), 2, 3 (низ)
                        const bitIndex = r * 2 + c;
                        
                        if ((block.mask & (1 << bitIndex)) !== 0) {
                            ctx.drawImage(
                                spritesImage, 
                                bx + texOffX + c * SUB_SIZE, 
                                by + texOffY + r * SUB_SIZE, 
                                SUB_SIZE, SUB_SIZE, 
                                col * TILE_SIZE + c * SUB_SIZE, 
                                row * TILE_SIZE + r * SUB_SIZE, 
                                SUB_SIZE, SUB_SIZE
                            );
                        }
                    }
                }
            } else if (block.type === 4) { // Вода
                const frames = SPRITES.blocks[4]; 
                const [sx, sy] = frames[waterFrame];
                // Вода анимируется целиком 16x16, но мы рисуем кусочек 8x8
                const texOffX = (col % 2) * 8;
                const texOffY = (row % 2) * 8;
                ctx.drawImage(spritesImage, sx + texOffX, sy + texOffY, 8, 8, col * 8, row * 8, 8, 8);
            } else if (block.type === 5) {
                const spriteCoords = SPRITES.blocks[block.type];
                if (spriteCoords) {
                    const [sx, sy] = spriteCoords;
                    const texOffX = (col % 2) * 8;
                    const texOffY = (row % 2) * 8;
                    ctx.drawImage(spritesImage, sx + texOffX, sy + texOffY, 8, 8, col * 8, row * 8, 8, 8);
                }
            }
        }
    }
}

export function drawForest(ctx, spritesImage, levelMap) {
    if (!levelMap) return;
    const forestSprite = SPRITES.blocks[3]; 
    if (!forestSprite) return;
    const [sx, sy] = forestSprite;

    for (let row = 0; row < levelMap.length; row++) {
        for (let col = 0; col < levelMap[row].length; col++) {
            const block = levelMap[row][col];
            if (block.type === 3) {
                const texOffX = (col % 2) * 8;
                const texOffY = (row % 2) * 8;
                ctx.drawImage(spritesImage, sx + texOffX, sy + texOffY, 8, 8, col * 8, row * 8, 8, 8);
            }
        }
    }
}

// --- СУЩНОСТИ ---

export function drawBases(ctx, spritesImage, bases, settings) {
    if (!bases) return;

    const now = Date.now();
    const isVibranium = settings && settings.vibraniumBase;
    const isVisibleWindow = (now % 3000) < 250;
    const shieldFrameIndex = Math.floor(now / 50) % 2;

    bases.forEach(base => {
        const teamName = (base.team === 1) ? 'yellow' : 'green';
        const key = `base_${teamName}`;
        
        const state = base.isDead ? 'dead' : 'alive';
        
        const sprite = SPRITES[`${key}_${state}`]; 
        ctx.drawImage(spritesImage, ...sprite, base.x, base.y, 16, 16);

        // 2. Рисуем Щит поверх, если база жива и таймер сработал
        if (!base.isDead && isVibranium && isVisibleWindow) {
            const shieldSprite = SPRITES.shield[shieldFrameIndex]; 
            
            if (shieldSprite) {
                ctx.drawImage(spritesImage, ...shieldSprite, base.x, base.y, 16, 16);
            }
        }
    });
}

export function drawBonus(ctx, spritesImage, bonus) {
    if (!bonus) return;
    // Можно добавить мигание, если есть таймер
    const coords = SPRITES.bonuses[bonus.type];
    if (coords) {
        ctx.drawImage(spritesImage, ...coords, bonus.x, bonus.y, TILE_BIG_SIZE, TILE_BIG_SIZE);
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

    const spawnFrame = Math.floor(Date.now() / 100) % 4; // Тот же таймер

    if (pendingSpawns) {
        pendingSpawns.forEach(s => {
            const frame = SPRITES.spawn_appear[spawnFrame];
            if (frame) {
                const [sx, sy, sw, sh] = frame;
                ctx.drawImage(spritesImage, sx, sy, sw, sh, s.x, s.y, TILE_BIG_SIZE, TILE_BIG_SIZE);
            }
        });
    }

    if (enemies) {
        enemies.forEach(enemy => {
            const color = (enemy.team === 1) ? 'yellow' : 'green';
            let key = `bot_${color}_${enemy.spriteKey}`; // bot_yellow_basic

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
                const idx = getTankFrame(enemy.id, enemy.isMoving);
                const frame = frames[idx];
                if (frame) {
                    const [sx, sy, sw, sh] = frame;
                    drawRotated(
                        ctx, spritesImage, 
                        sx, sy, sw, sh, 
                        Math.round(enemy.x), Math.round(enemy.y), TILE_BIG_SIZE, TILE_BIG_SIZE,
                        enemy.direction
                    );
                }
            }
        });
    }
}

export function drawPlayers(ctx, spritesImage, playersMap) {
    if (!playersMap) return;
    const spawnFrame = Math.floor(Date.now() / 100) % 4;

    Object.values(playersMap).forEach(p => {
        if (p.isDead) return;

        if (p.isSpawning) {
            const frame = SPRITES.spawn_appear[spawnFrame];
            
            if (frame) {
                const [sx, sy, sw, sh] = frame;
                ctx.drawImage(
                    spritesImage, 
                    sx, sy, sw, sh, 
                    // Округляем координаты (если используем интерполяцию, иначе они уже круглые)
                    Math.round(p.x), Math.round(p.y), 
                    TILE_BIG_SIZE, TILE_BIG_SIZE // 16x16
                );
            }
        } else {
            // Танк
            const color = (p.team === 1) ? 'yellow' : 'green';
            const lvl = p.level || 1;
            const key = `player_${color}_lvl${lvl}`;

            const frames = SPRITES[key] || SPRITES[`player_${color}_lvl1`];
            if (frames) {
                const idx = getTankFrame(p.id, p.isMoving);
                const frame = frames[idx];
                if (frame) {
                    const [sx, sy, sw, sh] = frame;
                    drawRotated(
                        ctx, spritesImage,
                        sx, sy, sw, sh,
                        Math.round(p.x), Math.round(p.y), TILE_BIG_SIZE, TILE_BIG_SIZE,
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
                    ctx.drawImage(spritesImage, sx, sy, sw, sh, Math.round(p.x), Math.round(p.y), TILE_BIG_SIZE, TILE_BIG_SIZE);
                }
            }
        }
    });
}
export function drawPlayerNames(ctx, playersMap, showNames, map, myTeam) {
    if (!playersMap) return;

    const SCALE = 3;
    const GAME_PADDING = 32;

    ctx.save();
    ctx.font = 'bold 10px "Press Start 2P", monospace'; // 10px лучше читается
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#a42020';
    ctx.lineWidth = 4;

    Object.values(playersMap).forEach(p => {
        if (p.isDead || !p.nickname) return;
        
        // --- ПРОВЕРКА ЛЕСА ---
        if (map) {
            const col = Math.floor((p.x + 8) / 16);
            const row = Math.floor((p.y + 8) / 16);
            
            if (map[row] && map[row][col] === 3) { // 3 = Лес
                if (p.team !== myTeam) return; 
            }
        }
        
        if (!showNames) return; // Обычная логика скрытия (если не TAB и не старт)

        // Центр танка в экранных координатах
        const cx = (p.x + GAME_PADDING + 8) * SCALE;
        const cy = (p.y + GAME_PADDING + 8) * SCALE;

        const offset = 38; // Отступ (чуть больше, чтобы не наезжать)

        let ty;
        
        // Логика выбора стороны
        // По умолчанию:
        // Team 1 (Green) -> Ник СНИЗУ (cy + offset)
        // Team 2 (Red)   -> Ник СВЕРХУ (cy - offset)
        
        if (p.team === 1) {
            // Зеленые: Снизу, если не едут ВНИЗ (чтобы не перекрывать путь)
            if (p.direction === 'DOWN') ty = cy - offset; // Прыгаем наверх
            else ty = cy + offset; // Обычно внизу
        } else {
            // Красные: Сверху, если не едут ВВЕРХ
            if (p.direction === 'UP') ty = cy + offset; // Прыгаем вниз
            else ty = cy - offset; // Обычно сверху
        }

        // Рисуем
        ctx.strokeText(p.nickname, cx, ty);
        ctx.fillText(p.nickname, cx, ty);
    });
    
    ctx.restore();
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
        animationSpeed: 9,// Мы рендеримся через requestAnimationFrame (обычно 60 FPS).
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

function getTankFrame(id, isMoving) {
    if (!animCache[id]) {
        animCache[id] = { frame: 0, timer: 0 };
    }

    const state = animCache[id];

    if (isMoving) {
        state.timer++;
        const ANIM_SPEED = 3; 
        
        if (state.timer > ANIM_SPEED) {
            state.timer = 0;
            state.frame = (state.frame === 0) ? 1 : 0;
        }
    }

    return state.frame;
}