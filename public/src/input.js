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
}