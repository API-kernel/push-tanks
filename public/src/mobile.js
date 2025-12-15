// Проверяем, мобилка ли это (грубая проверка)
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

if (isMobile) {
    document.body.classList.add('mobile-mode');
    initMobileControls();
}

function initMobileControls() {
    console.log("Mobile controls init");

    const zone = document.getElementById('zone_joystick');
    
    // 1. Джойстик (Слева)
    const manager = nipplejs.create({
        zone: zone,
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: 'white',
        size: 120
    });

    // Хелпер нажатия
    const setKey = (code, pressed) => {
        if (window.tankGameInput) {
            window.tankGameInput.keys[code] = pressed;
        }
    };

    // События джойстика
    manager.on('move', (evt, data) => {
        if (data.direction) {
            const dir = data.direction.angle; // up, down, left, right
            
            // Сбрасываем все
            setKey('ArrowUp', false);
            setKey('ArrowDown', false);
            setKey('ArrowLeft', false);
            setKey('ArrowRight', false);

            // Нажимаем нужное
            if (dir === 'up') setKey('ArrowUp', true);
            if (dir === 'down') setKey('ArrowDown', true);
            if (dir === 'left') setKey('ArrowLeft', true);
            if (dir === 'right') setKey('ArrowRight', true);
        }
    });

    manager.on('end', () => {
        // Отпустили джойстик -> сброс
        setKey('ArrowUp', false);
        setKey('ArrowDown', false);
        setKey('ArrowLeft', false);
        setKey('ArrowRight', false);
    });

    // 2. Кнопка Огня (Справа)
    const fireBtn = document.getElementById('btn_fire');
    
    // Используем touchstart/end для мгновенной реакции без задержки клика
    fireBtn.addEventListener('touchstart', (e) => {
        e.preventDefault(); // Чтобы не зумило и не выделяло
        setKey('Space', true); // P1 Fire (или Enter для P2, но на мобиле обычно 1 игрок)
        fireBtn.classList.add('pressed');
    });

    fireBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        setKey('Space', false);
        fireBtn.classList.remove('pressed');
    });
    
    // 3. Адаптация экрана (Fit to Screen)
    window.addEventListener('resize', resizeGame);
    resizeGame();
}

function resizeGame() {
    const container = document.getElementById('game-container');
    
    // Текущие размеры окна
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    
    // Исходные размеры игры (из CSS/Config)
    const baseW = 912;
    const baseH = 816;

    // Считаем масштаб: выбираем меньший коэффициент, чтобы влезало целиком
    const scale = Math.min(winW / baseW, winH / baseH);

    // Применяем масштаб
    container.style.transform = `translate(-50%, -50%) scale(${scale})`;
    
    // Центрируем абсолютно
    container.style.position = 'absolute';
    container.style.top = '50%';
    container.style.left = '50%';
    
    // Убираем марджины, которые могли мешать
    container.style.margin = '0';
}

window.toggleFullScreen = () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
};