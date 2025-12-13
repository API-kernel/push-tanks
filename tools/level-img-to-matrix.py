import os
import json
from PIL import Image

INPUT_FOLDER = "input_levels"
OUTPUT_FOLDER = "shared/maps"
TILE_SIZE = 8
GRID_SIZE = 26

def identify_block(img_crop):
    pixels = list(img_crop.getdata())
    
    # Счетчики
    scores = {
        1: 0, # Brick
        2: 0, # Steel
        3: 0, # Forest
        4: 0, # Water
        5: 0  # Ice
    }

    for p in pixels:
        r, g, b = p[:3]

        # 1. ЛЕС (Зеленый доминант)
        # G должен быть больше R и B существенно
        if g > r + 20 and g > b + 20:
            scores[3] += 1
            continue

        # 2. ВОДА (Синий доминант)
        if b > r + 30 and b > g + 10:
            scores[4] += 1
            continue

        # 3. КИРПИЧ (Красный доминант)
        # R > G > B
        if r > g + 20 and r > b + 20:
            scores[1] += 1
            continue

        # 4. СЕРЫЕ БЛОКИ (Бетон vs Лед)
        # У серых цветов R ~= G ~= B
        if abs(r - g) < 20 and abs(r - b) < 20 and abs(g - b) < 20:
            # Бетон очень яркий (блики)
            if r > 230:
                scores[2] += 2 # Сильный вес
            # Лед серый (170-190)
            elif 150 < r < 200:
                scores[5] += 1
            # Темные контуры бетона (100-140)
            elif 100 < r < 150:
                scores[2] += 0.5 # Слабый вес
                
    # Выбираем победителя
    best_type = 0
    max_score = 0
    
    for type_id, score in scores.items():
        if score > max_score:
            max_score = score
            best_type = type_id
            
    # Порог (минимум 15% пикселей должны совпасть)
    if max_score < len(pixels) * 0.15:
        return 0
        
    return best_type

def process_image(file_path):
    img = Image.open(file_path).convert('RGB')
    if img.size != (208, 208):
        img = img.resize((208, 208), Image.NEAREST)

    matrix = []
    for row in range(GRID_SIZE):
        row_data = []
        for col in range(GRID_SIZE):
            x = col * TILE_SIZE
            y = row * TILE_SIZE
            crop = img.crop((x, y, x+8, y+8))
            row_data.append(identify_block(crop))
        matrix.append(row_data)
    return matrix

def main():
    if not os.path.exists(OUTPUT_FOLDER):
        os.makedirs(OUTPUT_FOLDER)

    files = [f for f in os.listdir(INPUT_FOLDER) if f.endswith('.png')]
    for filename in files:
        name = os.path.splitext(filename)[0]
        matrix = process_image(os.path.join(INPUT_FOLDER, filename))
        
        # Сохраняем как JSON
        with open(f"{OUTPUT_FOLDER}/{name}.json", "w", encoding="utf-8") as f:
            f.write("[\n")
            for i, row in enumerate(matrix):
                # Форматируем строку без лишних пробелов в числах
                row_str = json.dumps(row, separators=(', ', ' '))
                # Добавляем отступ в 4 пробела (или \t для табуляции)
                if i < len(matrix) - 1:
                    f.write(f"    {row_str},\n")
                else:
                    f.write(f"    {row_str}\n")
            f.write("]")
            
    print(f"Generated {len(files)} JSON maps.")

if __name__ == "__main__":
    main()