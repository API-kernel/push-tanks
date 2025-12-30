import { SPRITES } from './sprites.js';
import { MAP_WIDTH, PADDING } from '../shared/config.js';

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
    const { players, enemies, pendingSpawns, settings, botsSpawnedCount, myTeam, myId } = data;
    
    const startX = MAP_WIDTH + PADDING + 4; 
    let cursorY = PADDING + 24; 

    // --- 1. СЕТКА ВРАГОВ (Без изменений) ---
    const enemyTeamId = (myTeam === 1) ? 2 : 1; 
    const enemyPlayersCount = Object.values(players).filter(p => p.team === enemyTeamId && p.lives >= 0).length;
    
    const reserveTotal = (settings.botsReserve && settings.botsReserve[enemyTeamId]) || 0;
    const spawnedAlready = (botsSpawnedCount && botsSpawnedCount[enemyTeamId]) || 0;
    const reserveLeft = Math.max(0, reserveTotal - spawnedAlready);
    
    const activeBots = enemies.filter(e => e.team === enemyTeamId).length;
    const activeSpawns = pendingSpawns.filter(s => s.team === enemyTeamId).length;
    const totalBots = reserveLeft + activeBots + activeSpawns;

    const totalIcons = enemyPlayersCount + totalBots;
    const iconsToDraw = Math.min(totalIcons, 20);
    const playerSpriteName = (enemyTeamId === 1) ? 'icon_tank_yellow' : 'icon_tank_green';

    for (let i = 0; i < iconsToDraw; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        let spriteKey = (i < enemyPlayersCount) ? playerSpriteName : 'icon_bot';
        const uiSprite = SPRITES.ui[spriteKey] || SPRITES.ui.icon_bot;
        if (uiSprite) {
            const [ix, iy, iw, ih] = uiSprite;
            ctx.drawImage(spritesImage, ix, iy, iw, ih, startX + col * 8, cursorY + row * 8, iw, ih);
        }
    }

    cursorY += 110; 

// --- 2. ЖИЗНИ ИГРОКОВ (Strict Local Mode) ---

    // Формируем ID локальных игроков
    const localP1Id = `${myId}_0`;
    const localP2Id = `${myId}_1`;

    let p1 = players[localP1Id];
    let p2 = players[localP2Id];

    // Проверяем, играют ли они (не зрители ли?)
    const p1Playing = p1 && p1.team !== 0;
    const p2Playing = p2 && p2.team !== 0;

    // СПЕЦ-КЕЙС: Если НИКТО из локальных не играет (я Зритель), 
    // показываем лидеров команд, чтобы было не скучно смотреть
    if (!p1Playing && !p2Playing) {
        const all = Object.values(players);
        p1 = all.find(p => p.team === 1); // Лидер Желтых
        p2 = all.find(p => p.team === 2); // Лидер Зеленых
    }

    // Хелпер для отрисовки
    const drawPlayerStats = (player, labelSprite, yPos) => {
        // Если игрока нет или он зритель - не рисуем статы
        if (!player || player.team === 0) return;

        const [lx, ly, lw, lh] = labelSprite;
        ctx.drawImage(spritesImage, lx, ly, lw, lh, startX, yPos, lw, lh);
        
        // Иконка
        const tankIconName = (player.team === 1) ? 'icon_tank_yellow' : 'icon_tank_green';
        const [tx, ty, tw, th] = SPRITES.ui[tankIconName] || SPRITES.ui.tank_icon;
        
        ctx.drawImage(spritesImage, tx, ty, tw, th, startX, yPos + 8, tw, th);
        
        // Цифра
        const livesToShow = Math.max(0, player.lives);
        drawNumber(ctx, spritesImage, livesToShow, startX + 10, yPos + 8);
    };

    // Рисуем I P
    if (p1) {
        drawPlayerStats(p1, SPRITES.ui.ip, cursorY);
    }
    cursorY += 24;

    // Рисуем II P
    if (p2) {
        drawPlayerStats(p2, SPRITES.ui.iip, cursorY);
    }
}