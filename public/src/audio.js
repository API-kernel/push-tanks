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
        // Создаем контекст (он будет suspended до первого клика)
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.buffers = {}; // Кэш загруженных звуков
        this.isLoaded = false;
        
        // Активные источники звука (для остановки лупов)
        // { playerId: { idle: SourceNode, move: SourceNode, currentType: 'idle'|'move' } }
        this.activeEngines = {}; 
    }

    // Загрузка всех звуков при старте
    async loadAll() {
        if (this.isLoaded) return;

        const promises = Object.entries(SOUNDS).map(async ([key, url]) => {
            try {
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                this.buffers[key] = audioBuffer;
            } catch (e) {
                console.error(`Failed to load sound: ${key}`, e);
            }
        });

        await Promise.all(promises);
        this.isLoaded = true;
        console.log("Audio loaded");
    }

    // Метод для "разморозки" аудио контекста по клику
    resume() {
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        this.loadAll(); // Запускаем загрузку, если еще не начали
    }

    play(name) {
        if (!this.isLoaded || !this.buffers[name]) return;
        
        // Создаем источник
        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers[name];
        
        // Подключаем к выходу (динамикам)
        // Можно добавить GainNode для громкости
        const gainNode = this.ctx.createGain();
        gainNode.gain.value = 0.4; // Громкость эффектов
        
        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        
        source.start(0);
    }

    updateEngine(playerId, isMoving) {
        if (!this.isLoaded) return;
        
        // Инициализируем структуру для игрока
        if (!this.activeEngines[playerId]) {
            this.activeEngines[playerId] = { source: null, type: null };
        }

        const engine = this.activeEngines[playerId];
        const neededType = isMoving ? 'move' : 'idle';

        // Если звук уже играет и он правильный - выходим
        if (engine.source && engine.type === neededType) return;

        // Останавливаем старый звук
        if (engine.source) {
            try { engine.source.stop(); } catch(e){}
            engine.source = null;
        }

        // Запускаем новый
        if (this.buffers[neededType]) {
            const source = this.ctx.createBufferSource();
            source.buffer = this.buffers[neededType];
            source.loop = true; // ИДЕАЛЬНЫЙ ЛУП
            
            const gainNode = this.ctx.createGain();
            gainNode.gain.value = 0.2; // Мотор потише
            
            source.connect(gainNode);
            gainNode.connect(this.ctx.destination);
            
            source.start(0);
            
            engine.source = source;
            engine.type = neededType;
        }
    }

    stopEngine(playerId) {
        const engine = this.activeEngines[playerId];
        if (engine && engine.source) {
            try { engine.source.stop(); } catch(e){}
            engine.source = null;
            engine.type = null;
        }
    }
}

export const audio = new AudioManager();

// Хак для автозапуска
const unlockAudio = () => {
    audio.resume();
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('click', unlockAudio);
};

window.addEventListener('keydown', unlockAudio);
window.addEventListener('click', unlockAudio);