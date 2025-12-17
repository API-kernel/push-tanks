// Состояние: создан ли джойстик (чтобы не дублировать при вкл/выкл)
let isNippleCreated = false;

// Глобальная функция для кнопки 🎮
window.toggleTouchMode = function() {
    const isMobile = document.body.classList.contains('mobile-mode');
    if (isMobile) {
        window.disableMobileControls();
    } else {
        window.initMobileControls();
    }
};

window.toggleFullScreen = () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
};

window.initMobileControls = function() {
    console.log("Enabling Mobile Controls");
    
    // 1. Включаем CSS класс и показываем UI
    document.body.classList.add('mobile-mode');
    const ui = document.getElementById('mobile-ui');
    if (ui) ui.style.display = 'flex'; // Используем flex для верстки кнопок
    
    // 2. Включаем ресайз игры под экран
    window.addEventListener('resize', resizeGame);
    resizeGame(); // Сразу применяем

    // 3. Создаем джойстик (ТОЛЬКО ОДИН РАЗ)
    if (isNippleCreated) return;
    
    isNippleCreated = true;
    const zone = document.getElementById('zone_joystick');
    
    // Nipple.js
    const manager = nipplejs.create({
        zone: zone,
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: 'white',
        size: 120
    });

    const setKey = (code, pressed) => {
        if (window.tankGameInput) {
            window.tankGameInput.keys[code] = pressed;
        }
    };

    manager.on('move', (evt, data) => {
        if (data.direction) {
            const dir = data.direction.angle;
            
            setKey('ArrowUp', false);
            setKey('ArrowDown', false);
            setKey('ArrowLeft', false);
            setKey('ArrowRight', false);

            if (dir === 'up') setKey('ArrowUp', true);
            if (dir === 'down') setKey('ArrowDown', true);
            if (dir === 'left') setKey('ArrowLeft', true);
            if (dir === 'right') setKey('ArrowRight', true);
        }
    });

    manager.on('end', () => {
        setKey('ArrowUp', false);
        setKey('ArrowDown', false);
        setKey('ArrowLeft', false);
        setKey('ArrowRight', false);
    });

    // Кнопка Огня
    const fireBtn = document.getElementById('btn_fire');
    if (fireBtn) {
        fireBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            setKey('Space', true); // P1 Fire
            fireBtn.classList.add('pressed');
        });
        fireBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            setKey('Space', false);
            fireBtn.classList.remove('pressed');
        });
        // Добавим mouse события для теста на ПК
        fireBtn.addEventListener('mousedown', () => { setKey('Space', true); fireBtn.classList.add('pressed'); });
        fireBtn.addEventListener('mouseup', () => { setKey('Space', false); fireBtn.classList.remove('pressed'); });
    }
};

window.disableMobileControls = function() {
    console.log("Disabling Mobile Controls");
    
    document.body.classList.remove('mobile-mode');
    
    // Скрываем UI
    const ui = document.getElementById('mobile-ui');
    if (ui) ui.style.display = 'none';
    
    // Сброс масштаба
    const container = document.getElementById('game-container');
    if (container) {
        container.style.transform = '';
        container.style.position = '';
        container.style.top = '';
        container.style.left = '';
        container.style.margin = '';
        container.style.zoom = '';
    }
    
    window.removeEventListener('resize', resizeGame);
};

function resizeGame() {
    const container = document.getElementById('game-container');
    if (!container) return;
    
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const gameW = 912;
    const gameH = 816;

    // Масштаб
    const scale = Math.min(winW / gameW, winH / gameH);

    // CSS Transform
    container.style.transform = `translate(-50%, -50%) scale(${scale})`;
    container.style.position = 'absolute';
    container.style.top = '50%';
    container.style.left = '50%';
    container.style.margin = '0';
}

// Авто-детект (опционально, если хочешь оставить)
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
if (isMobile) {
    // Ждем загрузки DOM
    window.addEventListener('load', () => window.initMobileControls());
}