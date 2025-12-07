// src/input.js
export class InputHandler {
    constructor() {
        this.keys = {}; // Храним состояние кнопок: { "ArrowUp": true, "KeyW": false }

        // Когда нажали кнопку - ставим true
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
        });

        // Когда отпустили - ставим false
        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
    }

    // Метод, который говорит игре, куда хочет игрок
    getDirection() {
        if (this.keys['ArrowUp'] || this.keys['KeyW']) return 'UP';
        if (this.keys['ArrowDown'] || this.keys['KeyS']) return 'DOWN';
        if (this.keys['ArrowLeft'] || this.keys['KeyA']) return 'LEFT';
        if (this.keys['ArrowRight'] || this.keys['KeyD']) return 'RIGHT';
        return null;
    }
}