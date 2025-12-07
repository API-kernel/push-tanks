import { TILE_SIZE } from './sprites.js';
import { level1 } from './level.js';

console.log("DEBUG PHYSICS: TILE_SIZE =", TILE_SIZE);
console.log("DEBUG PHYSICS: level1 =", level1); // <-- Должен вывести массив, а не undefined

const SOLID_BLOCKS = [1, 2, 4];

export function canMoveTo(newX, newY) {
    // 1. ЗАЩИТА: Если карта не загрузилась, разрешаем двигаться, чтобы игра не висла
    if (!level1 || !TILE_SIZE) {
        console.error("ОШИБКА: Физика не работает, нет карты или размеров!");
        return true; 
    }

    const pad = 2;
    const points = [
        { x: newX + pad, y: newY + pad },
        { x: newX + TILE_SIZE - pad, y: newY + pad },
        { x: newX + pad, y: newY + TILE_SIZE - pad },
        { x: newX + TILE_SIZE - pad, y: newY + TILE_SIZE - pad }
    ];

    for (const point of points) {
        const col = Math.floor(point.x / TILE_SIZE);
        const row = Math.floor(point.y / TILE_SIZE);

        // 2. Проверка границ массива
        if (row < 0 || row >= level1.length || col < 0 || col >= level1[0].length) {
            continue; 
        }

        const tileType = level1[row][col];

        if (SOLID_BLOCKS.includes(tileType)) {
            return false; // Стена
        }
    }

    return true;
}