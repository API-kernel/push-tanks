import { TILE_BIG_SIZE } from '../shared/config.js';

export function drawRotated(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh, direction) {
    ctx.save();
    
    // --- ПИКСЕЛЬНАЯ КОРРЕКЦИЯ ---
    // Танк 16x16 имеет асимметричные отступы (1px слева/сверху, 2px справа/снизу).
    // При вращении это вызывает смещение визуального центра.
    // Компенсируем это сдвигом на 1px в обратную сторону.
    
    let renderX = dx;
    let renderY = dy;

    if (dw === TILE_BIG_SIZE && dh === TILE_BIG_SIZE) { // Применяем только к танкам
        if (direction === 'DOWN') {
            renderX -= 1; // Компенсация разворота по горизонтали
        }
        else if (direction === 'RIGHT') {
            renderY += 1; // Компенсация разворота по вертикали
        }
    }

    // Смещаем в центр (уже скорректированный)
    ctx.translate(renderX + dw / 2, renderY + dh / 2);

    let angle = 0;
    if (direction === 'RIGHT') angle = 90 * (Math.PI / 180);
    if (direction === 'DOWN')  angle = 180 * (Math.PI / 180);
    if (direction === 'LEFT')  angle = -90 * (Math.PI / 180);
    // UP = 0

    ctx.rotate(angle);
    ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
}