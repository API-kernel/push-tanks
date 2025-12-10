// Функция вращения спрайта
export function drawRotated(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh, direction) {
    ctx.save();
    // Смещаем центр
    ctx.translate(dx + dw / 2, dy + dh / 2);

    let angle = 0;
    if (direction === 'RIGHT') angle = 90 * (Math.PI / 180);
    if (direction === 'DOWN')  angle = 180 * (Math.PI / 180);
    if (direction === 'LEFT')  angle = -90 * (Math.PI / 180);
    // UP = 0

    ctx.rotate(angle);
    ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
}