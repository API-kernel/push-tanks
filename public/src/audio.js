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
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        
        this.buffers = {};
        this.activeEngines = {};
        
        // Начинаем грузить звуки СРАЗУ при загрузке страницы
        this.loadAll();
    }

    async loadAll() {
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
        console.log("All sounds loaded");
    }

    // ЭТОТ МЕТОД НУЖНО ВЫЗВАТЬ ПРИ ЛЮБОМ КЛИКЕ
    resume() {
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().then(() => {
                console.log("AudioContext resumed!");
            });
            
            // Хак: проиграть тишину, чтобы точно разбудить мобильные браузеры
            const oscillator = this.ctx.createOscillator();
            oscillator.frequency.value = 440;
            const gain = this.ctx.createGain();
            gain.gain.value = 0;
            oscillator.connect(gain);
            gain.connect(this.ctx.destination);
            oscillator.start(0);
            oscillator.stop(0.1);
        }
    }

    play(name) {
        if (!this.buffers[name]) return;
        
        // Если контекст все еще спит - пытаемся будить (попытка не пытка)
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers[name];
        
        const gainNode = this.ctx.createGain();
        gainNode.gain.value = 0.4;
        
        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        
        source.start(0);
    }

    updateEngine(playerId, isMoving) {
        // ... (код без изменений) ...
        // Скопируй из прошлой версии, там все ок
        if (!this.activeEngines[playerId]) {
            this.activeEngines[playerId] = { source: null, type: null };
        }
        const engine = this.activeEngines[playerId];
        const neededType = isMoving ? 'move' : 'idle';
        if (engine.source && engine.type === neededType) return;
        if (engine.source) {
            try { engine.source.stop(); } catch(e){}
            engine.source = null;
        }
        if (this.buffers[neededType]) {
            const source = this.ctx.createBufferSource();
            source.buffer = this.buffers[neededType];
            source.loop = true;
            const gainNode = this.ctx.createGain();
            gainNode.gain.value = 0.2;
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