import { SPRITES, TILE_SIZE } from './sprites.js';
import { MAP_WIDTH, PADDING } from './config.js';

// Хелпер для отрисовки цифр (черных)
// Учитывает, что 0-4 на одной строке, 5-9 на следующей
function drawNumber(ctx, spritesImage, number, x, y) {
    const str = number.toString();

    for (let i = 0; i < str.length; i++) {
        const digit = parseInt(str[i]);
        
        // Просто берем спрайт из массива по индексу цифры
        const sprite = SPRITES.ui.nums[digit];

        if (sprite) {
            const [sx, sy, w, h] = sprite;
            ctx.drawImage(
                spritesImage,
                sx, sy, w, h,
                x + i * 8, y, 8, 8 // Сдвигаем каждую следующую цифру на 8px
            );
        }
    }
}

export function drawHUD(ctx, spritesImage, players) {
    const startX = MAP_WIDTH + 8;
    let cursorY = TILE_SIZE * 8; 

    const p1 = players.find(p => p.id === 1);
    if (p1) {
        const [ipX, ipY, ipW, ipH] = SPRITES.ui.ip;
        ctx.drawImage(spritesImage, ipX, ipY, ipW, ipH, startX, cursorY, ipW, ipH);
        
        cursorY += 8; 

        const [tx, ty, tw, th] = SPRITES.ui.tank_icon;
        ctx.drawImage(spritesImage, tx, ty, tw, th, startX, cursorY, tw, th);

        drawNumber(ctx, spritesImage, Math.max(0, p1.lives), startX + 8, cursorY);
        
        cursorY += 16;
    }

    const p2 = players.find(p => p.id === 2);
    if (p2) { 
        const [iipX, iipY, iipW, iipH] = SPRITES.ui.iip;
        ctx.drawImage(spritesImage, iipX, iipY, iipW, iipH, startX, cursorY, iipW, iipH);
        
        cursorY += 8;

        const [tx, ty, tw, th] = SPRITES.ui.tank_icon;
        ctx.drawImage(spritesImage, tx, ty, tw, th, startX, cursorY, tw, th);

        drawNumber(ctx, spritesImage, Math.max(0, p2.lives), startX + 8, cursorY);
        
        cursorY += 16;
    }

    const [fx, fy, fw, fh] = SPRITES.ui.flag;
    ctx.drawImage(spritesImage, fx, fy, fw, fh, startX, cursorY, fw, fh);
    
    drawNumber(ctx, spritesImage, 1, startX + 8, cursorY + 16); 
}