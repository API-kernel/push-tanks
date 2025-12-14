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

export function spawnBonus(x, y) {
    // Если координаты не переданы, выбираем случайные
    if (x === undefined || y === undefined) {
        const cols = Math.floor(MAP_WIDTH / TILE_SIZE) - 2;
        const rows = Math.floor(MAP_HEIGHT / TILE_SIZE) - 2;
        x = (Math.floor(Math.random() * cols) + 1) * TILE_SIZE;
        y = (Math.floor(Math.random() * rows) + 1) * TILE_SIZE;
    }

    activeBonus = {
        type: getRandomBonusType(),
        x: x,
        y: y,
        width: 16, height: 16,
        timer: 0 // Для мигания (сервер может просто слать, а клиент мигать)
    };
    
    return activeBonus; // Возвращаем, чтобы уведомить о событии (звук)
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