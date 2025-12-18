export class InputHandler {
    constructor() {
        this.keys = {};

        const gameKeys = [
            'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
            'KeyW', 'KeyA', 'KeyS', 'KeyD',  'Tab',
            'ControlLeft', 'ControlRight', 'ShiftLeft', 'Enter', 'Digit0'
        ];

        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; 

            this.keys[e.code] = true;
            
            if (gameKeys.includes(e.code)) {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
    }

    // Теперь принимает объект настроек: { up: 'KeyW', down: 'KeyS', ... }
    getDirection(keyMap) {
        if (!keyMap) return null;

        // Проверяем нажатия по переданной карте
        // Приоритет можно менять, но обычно UP/DOWN > LEFT/RIGHT или наоборот.
        // Здесь порядок: если зажаты две, победит первая в списке.
        
        if (this.keys[keyMap.up]) return 'UP';
        if (this.keys[keyMap.down]) return 'DOWN';
        if (this.keys[keyMap.left]) return 'LEFT';
        if (this.keys[keyMap.right]) return 'RIGHT';
        
        return null;
    }

    getInputsPacket(hasP2) {
        const kbP1 = this._getKbP1();
        const kbP2 = this._getKbP2();
        const gp1 = this.getGamepadState(0);
        const gp2 = this.getGamepadState(1);

        const inputs = {};

        if (!hasP2) {
            inputs[0] = this._mergeInputs(kbP1, kbP2, gp1, gp2);
        } else {
            inputs[0] = this._mergeInputs(kbP1, gp1);
            inputs[1] = this._mergeInputs(kbP2, gp2);
        }
        
        return inputs;
    }
    
    // Проверка UI кнопок
    isShowNamesPressed() {
        const gp1 = this.getGamepadState(0);
        const gp2 = this.getGamepadState(1);
        return this.keys['Tab'] || gp1.tab || gp2.tab;
    }

    // Внутренние хелперы (чтобы не дублировать код чтения клавиш)
    _getKbP1() {
        return {
            up: this.keys['KeyW'],
            down: this.keys['KeyS'], 
            left: this.keys['KeyA'],
            right: this.keys['KeyD'],
            fire: this.keys['Space'], 
            cheat0: this.keys['Digit0']
        };
    }
    
    _getKbP2() {
        return {
            up: this.keys['ArrowUp'],
            down: this.keys['ArrowDown'],
            left: this.keys['ArrowLeft'],
            right: this.keys['ArrowRight'],
            fire: this.keys['Enter'],
            cheat0: false
        };
    }
    
    _mergeInputs(...sources) {
        const res = { up: false, down: false, left: false, right: false, fire: false, cheat0: false };
        sources.forEach(s => {
            if(s.up) res.up=true; if(s.down) res.down=true;
            if(s.left) res.left=true; if(s.right) res.right=true;
            if(s.fire) res.fire=true; if(s.cheat0) res.cheat0=true;
        });
        
        return res;
    }

    getGamepadState(playerIndex) {
        const state = {
            up: false, down: false, left: false, right: false,
            fire: false, cheat0: false, tab: false, start: false
        };

        // Получаем список подключенных геймпадов
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = gamepads[playerIndex];

        if (!gp) return state; // Геймпад не подключен

        // Хелпер для проверки кнопки
        const btn = (b) => typeof b === "object" ? b.pressed : b === 1.0;

        // --- 1. СТАНДАРТНЫЕ КНОПКИ (D-PAD) ---
        if (btn(gp.buttons[12])) state.up = true;
        if (btn(gp.buttons[13])) state.down = true;
        if (btn(gp.buttons[14])) state.left = true;
        if (btn(gp.buttons[15])) state.right = true;

        // Огонь / Старт
        if (btn(gp.buttons[0])) state.fire = true; // A / X
        if (btn(gp.buttons[2])) state.fire = true; // X / Square
        if (btn(gp.buttons[9])) state.start = true; 
        if (btn(gp.buttons[8])) state.tab = true;

        // --- 2. ЛЕВЫЙ СТИК (Axes 0, 1) ---
        const deadzone = 0.5;
        if (gp.axes[1] < -deadzone) state.up = true;
        if (gp.axes[1] > deadzone)  state.down = true;
        if (gp.axes[0] < -deadzone) state.left = true;
        if (gp.axes[0] > deadzone)  state.right = true;

        // --- 3. СПЕЦИФИЧНАЯ ОСЬ 9 (Твоя крестовина) ---
        // ВНИМАНИЕ: Значения float, сравниваем с допуском (epsilon)
        if (gp.axes.length > 9) {
            const val = gp.axes[9];
            const epsilon = 0.1; // Допуск +/- 0.1

            // Вверх: -1.0
            if (Math.abs(val - (-1.0)) < epsilon) state.up = true;

            // Вниз: 0.14 (стандарт HAT обычно ~0.142857)
            if (Math.abs(val - 0.142) < epsilon) state.down = true;

            // Влево: 0.7 (стандарт HAT обычно ~0.714285)
            if (Math.abs(val - 0.714) < epsilon) state.left = true;

            // Вправо: -0.4 (стандарт HAT обычно ~-0.42857)
            if (Math.abs(val - (-0.428)) < epsilon) state.right = true;
        }

        return state;
    }
}