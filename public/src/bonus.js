import { TILE_SIZE, SPRITES } from './sprites.js';
import { BONUS_WEIGHTS, MAP_WIDTH, MAP_HEIGHT } from './config.js';
import { checkRectOverlap } from './utils.js';
import { audio } from './audio.js';

export let activeBonus = null; // На карте может быть только 1 бонус одновременно

// Генерация случайного типа на основе весов
function getRandomBonusType() {
    // 1. Считаем общий вес
    let totalWeight = 0;
    for (let key in BONUS_WEIGHTS) {
        totalWeight += BONUS_WEIGHTS[key];
    }

    // 2. Выбираем случайное число
    let random = Math.random() * totalWeight;

    // 3. Ищем, какой бонус выпал
    for (let key in BONUS_WEIGHTS) {
        if (random < BONUS_WEIGHTS[key]) {
            return key;
        }
        random -= BONUS_WEIGHTS[key];
    }
    return 'star'; // Fallback
}

export function spawnBonus(x, y) {
    // Если координаты не переданы (например, чит-код), выбираем случайные
    if (x === undefined || y === undefined) {
        // Рандом по сетке (отступаем от краев)
        const cols = Math.floor(MAP_WIDTH / TILE_SIZE) - 2;
        const rows = Math.floor(MAP_HEIGHT / TILE_SIZE) - 2;
        x = (Math.floor(Math.random() * cols) + 1) * TILE_SIZE;
        y = (Math.floor(Math.random() * rows) + 1) * TILE_SIZE;
    }

    activeBonus = {
        type: getRandomBonusType(),
        x: x,
        y: y,
        width: 16,
        height: 16,
        timer: 0, // Для анимации мигания
        existTimer: 0 // Можно добавить исчезновение через время, если нужно
    };

    audio.play('bonus_appear'); // Звук появления (нужно добавить в audio.js)
    console.log("BONUS SPAWNED:", activeBonus.type);
}

export function updateBonuses() {
    if (!activeBonus) return;

    activeBonus.timer++;
    // Можно добавить логику исчезновения через 30 секунд
}

export function drawBonuses(ctx, spritesImage) {
    if (!activeBonus) return;

    // Мигание (показываем/скрываем каждые 15 кадров)
    // if (Math.floor(activeBonus.timer / 15) % 2 === 0) {
        const coords = SPRITES.bonuses[activeBonus.type];
        if (coords) {
            ctx.drawImage(spritesImage, ...coords, activeBonus.x, activeBonus.y, 16, 16);
        }
    // }
}

// Проверка подбора
export function checkBonusCollection(player) {
    if (!activeBonus) return null;

    if (checkRectOverlap(player, activeBonus)) {
        const type = activeBonus.type;
        activeBonus = null; // Убираем с карты
        audio.play('bonus_take'); // Звук взятия (нужно добавить в audio.js)
        return type; // Возвращаем тип, чтобы game.js применил эффект
    }
    return null;
}