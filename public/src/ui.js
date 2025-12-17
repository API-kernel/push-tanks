import { SPRITES } from './sprites.js';
import { MAP_WIDTH, PADDING } from '../shared/config.js';

// Хелпер для цифр (используется для жизней танка IP/IIP)
function drawNumber(ctx, spritesImage, number, x, y) {
    const str = number.toString();
    for (let i = 0; i < str.length; i++) {
        const digit = parseInt(str[i]);
        const sprite = SPRITES.ui.nums[digit];
        if (sprite) {
            const [sx, sy, w, h] = sprite;
            ctx.drawImage(spritesImage, sx, sy, w, h, x + i * 8, y, 8, 8);
        }
    }
}

export function drawHUD(ctx, spritesImage, data) {
    const { players, enemies, pendingSpawns, settings, botsSpawnedCount, myTeam } = data;
    
    // Начало HUD (справа от карты)
    const startX = MAP_WIDTH + PADDING + 4; 
    let cursorY = PADDING; // Чуть ниже, чтобы не наехать на STAGE текст

    // 1. ВРАГИ (Сетка иконок)
    
    // Определяем команду врага
    const enemyTeamId = (myTeam === 1) ? 2 : 1; 
    
    // Считаем общее кол-во сил врага
    // А) Считаем живых игроков врага
    // (Считаем тех, кто не мертв. Если хочешь считать и тех кто на респауне, используй p.lives >= 0)
    const enemyPlayersCount = Object.values(players).filter(p => p.team === enemyTeamId && p.lives >= 0).length;

    // Б) Считаем ботов (Резерв + Активные + Спавнящиеся)
    const reserveTotal = (settings.botsReserve && settings.botsReserve[enemyTeamId]) || 0;
    const spawnedAlready = (botsSpawnedCount && botsSpawnedCount[enemyTeamId]) || 0;
    const reserveLeft = Math.max(0, reserveTotal - spawnedAlready);
    
    const activeBots = enemies.filter(e => e.team === enemyTeamId).length;
    const activeSpawns = pendingSpawns.filter(s => s.team === enemyTeamId).length;
    
    const totalBots = reserveLeft + activeBots + activeSpawns;

    // Итого иконок
    const totalIcons = enemyPlayersCount + totalBots;
    const iconsToDraw = Math.min(totalIcons, 20);

    // Определяем имя цветного спрайта для игроков (зависит от того, кто враг)
    const playerSpriteName = (enemyTeamId === 1) ? 'icon_tank_yellow' : 'icon_tank_green';

    for (let i = 0; i < iconsToDraw; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        
        let spriteKey;

        // Логика выбора иконки:
        if (i < enemyPlayersCount) {
            // Сначала рисуем игроков их цветом
            spriteKey = playerSpriteName;
        } else {
            // Остальное - боты (серые)
            spriteKey = 'icon_bot';
        }

        const uiSprite = SPRITES.ui[spriteKey];
        if (uiSprite) {
            const [ix, iy, iw, ih] = uiSprite;
            ctx.drawImage(spritesImage, ix, iy, iw, ih, startX + col * 8, cursorY + row * 8, iw, ih);
        }
    }

    cursorY += 140; // Отступ вниз к жизням

    // 2. ЖИЗНИ ИГРОКОВ (IP / IIP)
    const p1 = Object.values(players).find(p => p.playerIndex === 0);
    if (p1) {
        const [ipX, ipY, ipW, ipH] = SPRITES.ui.ip;
        ctx.drawImage(spritesImage, ipX, ipY, ipW, ipH, startX, cursorY, ipW, ipH);
        
        const [tx, ty, tw, th] = SPRITES.ui.tank_icon;
        ctx.drawImage(spritesImage, tx, ty, tw, th, startX, cursorY + 8, tw, th);
        drawNumber(ctx, spritesImage, Math.max(0, p1.lives), startX + 10, cursorY + 8);
        cursorY += 24;
    }

    const p2 = Object.values(players).find(p => p.playerIndex === 1);
    if (p2) { 
        const [iipX, iipY, iipW, iipH] = SPRITES.ui.iip;
        ctx.drawImage(spritesImage, iipX, iipY, iipW, iipH, startX, cursorY, iipW, iipH);
        
        const [tx, ty, tw, th] = SPRITES.ui.tank_icon;
        ctx.drawImage(spritesImage, tx, ty, tw, th, startX, cursorY + 8, tw, th);
        drawNumber(ctx, spritesImage, Math.max(0, p2.lives), startX + 10, cursorY + 8);
        cursorY += 32;
    }
}