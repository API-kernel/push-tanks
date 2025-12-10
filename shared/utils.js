export function checkRectOverlap(r1, r2) {
    const r1w = r1.width || 16;
    const r1h = r1.height || 16;
    const r2w = r2.width || 16;
    const r2h = r2.height || 16;
    
    return (r1.x < r2.x + r2w &&
            r1.x + r1w > r2.x &&
            r1.y < r2.y + r2h &&
            r1.y + r1h > r2.y);
}