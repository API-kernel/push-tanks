let localPlayersCount = 1;
let isMyHost = false;

let mySocketId = null; // Нужно сохранить ID сокета (передадим из game.js)

// Вызывается из game.js при подключении
window.setMyId = (id) => { mySocketId = id; };

// Функция смены команды (отправляет на сервер)
window.changeTeam = (localIndex, teamId) => {
    if (window.tankGame) window.tankGame.changeTeam(localIndex, teamId);
};

window.changeSettings = () => {
    if (!isMyHost) return;
    const level = parseInt(document.getElementById('opt-level').value);
    const lives = parseInt(document.getElementById('opt-lives').value);
    const maxActive = parseInt(document.getElementById('opt-max-active').value);
    
    const botsGreen = parseInt(document.getElementById('opt-bots-green').value);
    const botsRed = parseInt(document.getElementById('opt-bots-red').value);
    const hotjoin = document.getElementById('opt-hotjoin').checked;

    if (window.tankGame) {
        window.tankGame.updateSettings({ 
            level, 
            startLives: lives, 
            maxActiveEnemies: maxActive,
            botsReserve: { 1: botsGreen, 2: botsRed }, // Передаем объект
            allowHotJoin: hotjoin 
        });
    }
};

window.changeName = (localIndex, val) => {
    if (window.tankGame) window.tankGame.changeName(localIndex, val);
};

window.selectLocalPlayers = (n) => {
    localPlayersCount = n;
    document.getElementById('btn-1p').classList.toggle('selected', n === 1);
    document.getElementById('btn-2p').classList.toggle('selected', n === 2);
    
    // Показываем второе поле
    document.getElementById('nick-p2').style.display = (n === 2) ? 'inline-block' : 'none';
};

window.updateLobbyUI = (data) => {
    // data = { players, settings }
    
    // 1. Обновляем список игроков (старая функция)
    updateLobbyList(data.players);

    // 2. Обновляем Настройки
    if (data.settings) {
        const lvlInput = document.getElementById('opt-level');

        // Если я НЕ хост, я обновляю свои инпуты значениями с сервера
        // Если я ХОСТ, я не обновляю, чтобы курсор не прыгал (хотя можно и обновить)
        if (!isMyHost) {
            lvlInput.value = data.settings.level;
            
            // Блокируем для не-хоста
            lvlInput.disabled = true;
        } else {
            lvlInput.disabled = false;
        }
    }
};

window.updateLobbyList = (players) => {
    // 1. Запоминаем фокус
    const activeEl = document.activeElement;
    const activeId = activeEl ? activeEl.id : null;
    // Если мы печатаем в инпуте, запомним позицию курсора
    const selectionStart = activeEl ? activeEl.selectionStart : 0;
    const selectionEnd = activeEl ? activeEl.selectionEnd : 0;

    const container = document.getElementById('lobby-players');
    container.innerHTML = '';

    // Сортировка
    const sortedPlayers = Object.values(players).sort((a, b) => {
        if (a.socketId === mySocketId && b.socketId !== mySocketId) return -1;
        if (a.socketId !== mySocketId && b.socketId === mySocketId) return 1;
        return a.localIndex - b.localIndex;
    });

    let myCount = 0;

    sortedPlayers.forEach(p => {
        if (p.socketId === mySocketId) myCount++;

        const div = document.createElement('div');
        div.className = 'lobby-player-row';
        
        const isMe = p.socketId === mySocketId;
        
        // Генерируем уникальный ID для инпута, чтобы восстановить фокус
        const inputId = `nick-input-${p.socketId}-${p.localIndex}`;
        
        let nameHtml = '';
        if (isMe) {
            let val = p.nickname || "";
            if (activeId === inputId && activeEl) {
                val = activeEl.value; // Оставляем локальное значение
            }

            nameHtml = `<input type="text" id="${inputId}" class="lobby-name-input" 
                value="${val}" 
                onchange="changeName(${p.localIndex}, this.value)" 
                maxlength="10">`;
        } else {
            nameHtml = `<span class="lobby-name-text" style="color:${p.team === 1 ? '#63db44' : '#d43333'}">${p.nickname || 'Unknown'}</span>`;
        }

        // 2. КОЛОНКА КНОПОК
        let actionsHtml = '';
        
        if (isMe) {
            // Кнопки команд с подсветкой
            const greenClass = p.team === 1 ? 'team-btn team-btn-green active' : 'team-btn team-btn-green';
            const redClass =   p.team === 2 ? 'team-btn team-btn-red active'   : 'team-btn team-btn-red';
            
            actionsHtml += `<button class="${greenClass}" onclick="changeTeam(${p.localIndex}, 1)">GREEN</button>`;
            actionsHtml += `<button class="${redClass}" onclick="changeTeam(${p.localIndex}, 2)">RED</button>`;
            
            // Кнопка удаления
            if (p.localIndex > 0) {
                actionsHtml += `<button class="btn-remove" onclick="removeLocalPlayer(${p.localIndex})">×</button>`;
            } else {
                actionsHtml += `<div class="btn-placeholder"></div>`; // Пустое место для выравнивания
            }
        } else {
            // Для чужих просто пишем команду
            const color = p.team === 1 ? '#63db44' : '#d43333';
            const label = p.team === 1 ? 'GREEN' : 'RED';
            actionsHtml = `<span class="team-label" style="color: ${color}; font-weight: bold;">${label}</span>`;
        }
        
        div.innerHTML = nameHtml + actionsHtml;
        container.appendChild(div);
    });

    // Кнопка добавления
    if (myCount < 2) {
        const addDiv = document.createElement('div');
        addDiv.className = 'lobby-add-row';
        addDiv.innerHTML = `<button onclick="addLocalPlayer()">+ ADD LOCAL PLAYER</button>`;
        container.appendChild(addDiv);
    }

    if (activeId) {
        const el = document.getElementById(activeId);
        if (el) {
            el.focus();
            // Восстанавливаем курсор
            if (el.setSelectionRange) {
                el.setSelectionRange(selectionStart, selectionEnd);
            }
        }
    }
};

window.addLocalPlayer = () => {
    if (window.tankGame) window.tankGame.addLocalPlayer();
};

window.removeLocalPlayer = (idx) => {
    if (window.tankGame) window.tankGame.removeLocalPlayer(idx);
};

function createRoom() {
    // Вызываем функцию из game.js (нам нужно экспортировать её или повесить на window)
    // Так как game.js - модуль, мы не можем просто вызвать функцию оттуда.
    // Решение: game.js при старте повесит свои методы на window.tankGame
    if (window.tankGame) {
        window.tankGame.initAudio();
        window.tankGame.createRoom(localPlayersCount);
    }
}

function joinRoom() {
    const code = document.getElementById('room-code').value.toUpperCase();
    if (code.length < 2) {
        alert("Enter Room ID!");
        return;
    }
    if (window.tankGame) {
        window.tankGame.initAudio();
        window.tankGame.joinRoom(code, localPlayersCount);
    }
}

function startGame() {
    if (window.tankGame) {
        window.tankGame.requestStart();
    }
}

// Функции для управления экранами (вызываются из game.js)
window.showLobby = (roomId, isHost) => {
    console.log("Show Lobby. Host:", isHost);
    isMyHost = isHost;
    document.getElementById('menu-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'flex';
    document.getElementById('display-room-id').innerText = roomId;
    
    if (isHost) {
        document.getElementById('btn-start').style.display = 'block';
    }
};

window.hideMenu = () => {
    document.getElementById('menu-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'none';
};

function quickPlay() {
    if (window.tankGame) {
        window.tankGame.initAudio();
        window.tankGame.quickPlay(localPlayersCount);
    }
}

function changeSettings() {
    if (!isMyHost) return;

    const level = parseInt(document.getElementById('opt-level').value);
    const bots = document.getElementById('opt-bots').checked;
    const hotjoin = document.getElementById('opt-hotjoin').checked; // Новая галочка

    if (window.tankGame) {
        window.tankGame.updateSettings({ 
            level, 
            startLives: lives, 
            maxActiveEnemies: maxActive,
            botsEnabled: bots,
            allowHotJoin: hotjoin 
        });
    }
}

window.updateLobbyUI = (data) => {
    updateLobbyList(data.players);

    if (data.settings) {
        const lvlInput = document.getElementById('opt-level');
        const hotjoinInput = document.getElementById('opt-hotjoin'); // Новая галочка
        const greenInput = document.getElementById('opt-bots-green');
        const redInput = document.getElementById('opt-bots-red');

        if (!isMyHost) {
            lvlInput.value = data.settings.level;
            hotjoinInput.checked = data.settings.allowHotJoin;
            greenInput.value = data.settings.botsReserve[1] || 0;
            redInput.value = data.settings.botsReserve[2] || 0;

            lvlInput.disabled = true;
            hotjoinInput.disabled = true;
            greenInput.disabled = true;
            redInput.disabled = true;
        } else {
            lvlInput.disabled = false;
            hotjoinInput.disabled = false;
            greenInput.disabled = false;
            redInput.disabled = false;
        }
    }
};