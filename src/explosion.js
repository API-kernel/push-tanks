import { SPRITES } from './sprites.js';

export const explosions = [];

export const EXPLOSION_SMALL = 'SMALL';
export const EXPLOSION_BIG = 'BIG';

export function createExplosion(x, y, type = EXPLOSION_SMALL) {
    explosions.push({
        x, y,
        type,
        frameIndex: 0,
        timer: 0,
        animationSpeed: 2, // Смена кадра каждые 4 тика
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

        if (boom.isDead) {
            explosions.splice(i, 1);
        }
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
            // Рисуем центрировано
            ctx.drawImage(
                spritesImage, 
                sx, sy, sw, sh, 
                Math.round(boom.x - sw / 2), Math.round(boom.y - sh / 2), sw, sh
            );
        }
    });
}