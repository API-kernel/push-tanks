import { TILE_BIG_SIZE } from '../shared/config.js';

export function checkRectOverlap(r1, r2) {
    const r1w = r1.width || TILE_BIG_SIZE;
    const r1h = r1.height || TILE_BIG_SIZE;
    const r2w = r2.width || TILE_BIG_SIZE;
    const r2h = r2.height || TILE_BIG_SIZE;
    
    return (r1.x < r2.x + r2w &&
            r1.x + r1w > r2.x &&
            r1.y < r2.y + r2h &&
            r1.y + r1h > r2.y);
}