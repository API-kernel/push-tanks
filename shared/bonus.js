import { TILE_SIZE, BONUS_WEIGHTS, MAP_WIDTH, MAP_HEIGHT } from './config.js';
import { checkRectOverlap } from './utils.js';

let activeBonus = null; // Объект { x, y, type }

function getRandomBonusType() {
    let totalWeight = 0;
    for (let key in BONUS_WEIGHTS) totalWeight += BONUS_WEIGHTS[key];

    let random = Math.random() * totalWeight;
    for (let key in BONUS_WEIGHTS) {
        if (random < BONUS_WEIGHTS[key]) return key;
        random -= BONUS_WEIGHTS[key];
    }
    return 'star';
}

export function spawnBonus(map, bases, x, y) {
    // Если координаты НЕ переданы (случайный спавн при убийстве бота)
    if (x === undefined || y === undefined) {
        const cols = Math.floor(MAP_WIDTH / TILE_SIZE) - 2;
        const rows = Math.floor(MAP_HEIGHT / TILE_SIZE) - 2;
        
        let attempts = 0;
        let valid = false;

        // Пытаемся 50 раз найти хорошее место
        while (!valid && attempts < 50) {
            // Генерируем случайную точку в сетке
            x = (Math.floor(Math.random() * cols) + 1) * TILE_SIZE;
            y = (Math.floor(Math.random() * rows) + 1) * TILE_SIZE;

            if (isValidBonusPosition(x, y, map, bases)) {
                valid = true;
            }
            attempts++;
        }
    }

    activeBonus = {
        id: Date.now() + Math.random(), // Уникальный ID для звука
        type: getRandomBonusType(),
        x: x,
        y: y,
        width: 16, height: 16,
        timer: 0 
    };
    
    return activeBonus;
}

function isValidBonusPosition(x, y, map, bases) {
    if (!map) return true; // Если карты нет, разрешаем (фоллбэк)

    // 1. Проверка тайлов (Вода и Бетон)
    // Бонус 16x16 занимает 4 клетки карты (8x8)
    // Проверим все 4 угла, чтобы не зацепить воду
    const corners = [
        { cx: x, cy: y },
        { cx: x + 10, cy: y },
        { cx: x, cy: y + 10 },
        { cx: x + 10, cy: y + 10 }
    ];

    for (let p of corners) {
        const col = Math.floor(p.cx / TILE_SIZE);
        const row = Math.floor(p.cy / TILE_SIZE);

        if (row >= 0 && row < map.length && col >= 0 && col < map[0].length) {
            const block = map[row][col];
            // Тип 2 = Бетон, Тип 4 = Вода
            if (block.type === 2 || block.type === 4) return false;
        }
    }

    // 2. Проверка Баз (Флагов)
    // Нельзя спавнить прямо на орле
    const bonusRect = { x, y, width: 16, height: 16 };
    if (bases) {
        for (const base of bases) {
            if (checkRectOverlap(bonusRect, base)) return false;
        }
    }

    return true;
}

export function getActiveBonus() {
    return activeBonus;
}

export function clearBonus() {
    activeBonus = null;
}

export function createRandomBonus(x, y) {
    if (x === undefined || y === undefined) {
        const cols = Math.floor(MAP_WIDTH / TILE_SIZE) - 2;
        const rows = Math.floor(MAP_HEIGHT / TILE_SIZE) - 2;
        x = (Math.floor(Math.random() * cols) + 1) * TILE_SIZE;
        y = (Math.floor(Math.random() * rows) + 1) * TILE_SIZE;
    }

    return {
        id: Date.now() + Math.random(), // Уникальный ID
        type: getRandomBonusType(),
        x: x,
        y: y,
        width: 16, height: 16,
        timer: 0 
    };
}

// Проверяет, взял ли игрок бонус
export function checkBonusCollection(player, bonus) {
    if (!bonus) return null;
    const bonusRect = {
        x: bonus.x + 5,
        y: bonus.y + 5,
        width: 10,
        height: 10
    };

    if (checkRectOverlap(player, bonusRect)) {
        return bonus.type;
    }

    return null;
}