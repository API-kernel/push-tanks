const TILE_SIZE = 16; // Размер стандартного блока 16x16

export const SpriteMap = {
    // --- ИГРОК 1 (Желтый) ---
    // Формат: [x, y, width, height]
    // Танк 1 уровня (Basic)
    player1_lvl1_up_1:    [0 * TILE_SIZE, 0 * TILE_SIZE, TILE_SIZE, TILE_SIZE],
    player1_lvl1_up_2:    [1 * TILE_SIZE, 0 * TILE_SIZE, TILE_SIZE, TILE_SIZE], // Анимация гусениц
    player1_lvl1_left_1:  [2 * TILE_SIZE, 0 * TILE_SIZE, TILE_SIZE, TILE_SIZE],
    player1_lvl1_left_2:  [3 * TILE_SIZE, 0 * TILE_SIZE, TILE_SIZE, TILE_SIZE],
    player1_lvl1_down_1:  [4 * TILE_SIZE, 0 * TILE_SIZE, TILE_SIZE, TILE_SIZE],
    player1_lvl1_down_2:  [5 * TILE_SIZE, 0 * TILE_SIZE, TILE_SIZE, TILE_SIZE],
    player1_lvl1_right_1: [6 * TILE_SIZE, 0 * TILE_SIZE, TILE_SIZE, TILE_SIZE],
    player1_lvl1_right_2: [7 * TILE_SIZE, 0 * TILE_SIZE, TILE_SIZE, TILE_SIZE],

    // --- ЛАНДШАФТ (Находятся справа от танков) ---
    // Нужно будет точно посчитать отступ в пикселях.
    // Судя по картинке, танки занимают 16 колонок (8 направлений * 2 кадра)
    // Значит ландшафт начинается где-то с X = 256 (16 * 16)
    
    brick_wall:           [256, 0, 16, 16], // Полный кирпич
    brick_wall_right:     [256 + 8, 0, 8, 16], // Половинка (для разрушаемости)
    stone_wall:           [256, 16, 16, 16],
    water_1:              [256, 32, 16, 16], // Вода (кадр 1)
    water_2:              [272, 32, 16, 16], // Вода (кадр 2)
    forest:               [256 + 16, 16, 16, 16], // Кусты (зеленые)
    ice:                  [256 + 32, 16, 16, 16], // Лед

    // --- БОНУСЫ ---
    bonus_helmet:         [256, 112, 16, 16], // Примерные координаты, нужно уточнить
    bonus_clock:          [272, 112, 16, 16],
    bonus_shovel:         [288, 112, 16, 16],
    bonus_star:           [304, 112, 16, 16],
    bonus_grenade:        [320, 112, 16, 16],
    bonus_tank:           [336, 112, 16, 16],
    bonus_gun:            [352, 112, 16, 16], // Тот самый пистолет из Tank 1990!

    // --- ОРЕЛ ---
    base_eagle:           [304, 32, 16, 16],
    base_dead:            [320, 32, 16, 16],
    
    // --- ПУЛЯ ---
    bullet_up:            [320, 100, 3, 4], // Пуля маленькая, размеры другие
};