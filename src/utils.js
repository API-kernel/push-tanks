// Проверка пересечения двух прямоугольников (AABB)
export function checkRectOverlap(r1, r2) {
    // Если у объектов нет явных размеров, считаем их 16x16 (стандартный тайл)
    const r1w = r1.width || 16;
    const r1h = r1.height || 16;
    const r2w = r2.width || 16;
    const r2h = r2.height || 16;
    
    return (r1.x < r2.x + r2w &&
            r1.x + r1w > r2.x &&
            r1.y < r2.y + r2h &&
            r1.y + r1h > r2.y);
}

export function drawRotated(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh, direction) {
    ctx.save();
    
    // 1. Смещаем точку начала координат в ЦЕНТР будущего танка
    ctx.translate(dx + dw / 2, dy + dh / 2);

    // 2. Поворачиваем холст
    let angle = 0;
    if (direction === 'RIGHT') angle = 90 * (Math.PI / 180);
    if (direction === 'DOWN')  angle = 180 * (Math.PI / 180);
    if (direction === 'LEFT')  angle = -90 * (Math.PI / 180);
    // UP = 0

    ctx.rotate(angle);

    // 3. Рисуем картинку.
    // Важно: координаты теперь смещены на (-width/2, -height/2), так как мы уже в центре
    ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);

    ctx.restore();
}