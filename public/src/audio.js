// Список файлов
const SOUNDS = {
    base_crash: './assets/explosion_player.mp3',
    fire:       './assets/fire.mp3',
    ice_skid:       './assets/ice_skid.mp3',
    game_over:  './assets/game_over.mp3',
    intro:      './assets/intro.mp3',
    miss_hit:         './assets/miss_hit.mp3',
    brick_hit:        './assets/brick_hit.mp3',
    concrete_hit:     './assets/concrete_hit.mp3',
    armor_hit:        './assets/armor_hit.mp3',
    explosion_bot:    './assets/explosion_bot.mp3',
    explosion_player: './assets/explosion_player.mp3',
    bonus_appear: './assets/bonus_appear.mp3', // (Найди или добавь)
    bonus_take:   './assets/bonus_take.mp3',   // (Найди или добавь)
    life_up:      './assets/life_up.mp3',      // (Найди или добавь)
    
    // Для моторов нам нужно будет управлять экземплярами отдельно
    idle:       './assets/idle.mp3',
    move:       './assets/move.mp3'
};

class AudioManager {
    constructor() {
        this.buffers = {};
        this.context = null; // AudioContext создадим при первом клике (политика браузеров)
        this.isReady = false;
        
        // Хранилище звуков моторов для каждого игрока: { 1: { move: Audio, idle: Audio } }
        this.engineSounds = {}; 
    }

    // Инициализация по первому клику
    init() {
        if (this.isReady) return;
        
        // Простая реализация через HTML5 Audio для начала (проще, чем WebAudioAPI)
        // Предзагрузка не критична для локалки
        this.isReady = true;
    }

    play(name) {
        if (!this.isReady) return;
        const src = SOUNDS[name];
        if (!src) return;

        const audio = new Audio(src);
        audio.volume = 0.6; // Чуть тише, чтобы не оглохнуть
        
        // Ошибка "play() failed because the user didn't interact" может быть, 
        // поэтому всегда оборачиваем в catch
        audio.play().catch(e => {}); 
    }

    // Управление мотором танка
    updateEngine(playerId, isMoving) {
        if (!this.isReady) return;

        // Если для этого игрока еще нет звуков - создаем
        if (!this.engineSounds[playerId]) {
            this.engineSounds[playerId] = {
                idle: new Audio(SOUNDS.idle),
                move: new Audio(SOUNDS.move),
                current: null // Кто сейчас играет
            };
            
            // Настройки
            const s = this.engineSounds[playerId];
            s.idle.loop = true;
            s.move.loop = true;
            s.idle.volume = 0.3;
            s.move.volume = 0.3;
        }

        const s = this.engineSounds[playerId];
        const target = isMoving ? s.move : s.idle;
        const other = isMoving ? s.idle : s.move;

        // Если нужное уже играет - ничего не делаем
        if (s.current === target) return;

        // Переключаем
        other.pause();
        // other.currentTime = 0; // Можно сбрасывать, а можно нет (для плавности)
        
        target.play().catch(e => {});
        s.current = target;
    }

    stopEngine(playerId) {
        const s = this.engineSounds[playerId];
        if (s) {
            s.idle.pause();
            s.move.pause();
            s.current = null;
        }
    }

    stopAll() {
        // Остановить все моторы (при Game Over)
        Object.values(this.engineSounds).forEach(s => {
            s.idle.pause();
            s.move.pause();
        });
    }
}

export const audio = new AudioManager();

// Хак для автозапуска аудио контекста в Chrome
window.addEventListener('keydown', () => audio.init(), { once: true });
window.addEventListener('click', () => audio.init(), { once: true });