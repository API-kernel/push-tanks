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
    const level = document.getElementById('opt-level-select').value;
    const lives = parseInt(document.getElementById('opt-lives').value);
    const maxActive = parseInt(document.getElementById('opt-max-active').value);
    
    const botsGreen = parseInt(document.getElementById('opt-bots-green').value);
    const botsRed = parseInt(document.getElementById('opt-bots-red').value);
    const hotjoin = document.getElementById('opt-hotjoin').checked;
    const bases = document.getElementById('opt-bases').checked;
    const autonext = document.getElementById('opt-autonext').checked;

    if (window.tankGame) {
        window.tankGame.updateSettings({ 
            level, 
            startLives: lives, 
            maxActiveEnemies: maxActive,
            basesEnabled: bases,
            autoNextLevel: autonext,
            botsReserve: { 1: botsGreen, 2: botsRed }, // Передаем объект
            allowHotJoin: hotjoin 
        });
    }
};

window.updateMapSelector = (list) => {
    const select = document.getElementById('opt-level-select'); // Создадим его в HTML
    if (!select) return;
    
    const currentVal = select.value;
    
    select.innerHTML = '';
    list.forEach(mapName => {
        const opt = document.createElement('option');
        opt.value = mapName;
        opt.innerText = mapName.toUpperCase(); // Красиво
        select.appendChild(opt);
    });
};

window.backToMenu = () => {
    location.reload(); 
};

window.changeName = (localIndex, val) => {
    localStorage.setItem(`tank_nick_p${localIndex+1}`, val); 
    if (window.tankGame) window.tankGame.changeName(localIndex, val);
};

window.selectLocalPlayers = (n) => {
    localPlayersCount = n;
    document.getElementById('btn-1p').classList.toggle('selected', n === 1);
    document.getElementById('btn-2p').classList.toggle('selected', n === 2);
    
    // Показываем второе поле
    document.getElementById('nick-p2').style.display = (n === 2) ? 'inline-block' : 'none';
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
            
            let val = p.nickname;
            if (!val) {
                 val = localStorage.getItem(`tank_nick_p${p.localIndex+1}`) || "";
                 if (val) changeName(p.localIndex, val);
            }

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
                if (el.type === 'text' || el.type === 'password') {
                    el.setSelectionRange(selectionStart, selectionEnd);
                }
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
        window.tankGame.createRoom(localPlayersCount, getNicknames());
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
        window.tankGame.quickPlay(localPlayersCount, getNicknames());
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

function getNicknames() {
    const n1 = localStorage.getItem('tank_nick_p1') || "P1";
    const n2 = localStorage.getItem('tank_nick_p2') || "P2";
    return [n1, n2];
}

window.updateLobbyUI = (data) => {
    updateLobbyList(data.players);

    if (data.settings) {
        const s = data.settings;
        
        const setVal = (id, val, isCheck) => {
            const el = document.getElementById(id);
            if (isCheck) el.checked = val;
            else el.value = val;
            
            el.disabled = !isMyHost;
        };
        
        const sel = document.getElementById('opt-level-select');
        if (sel) {
            sel.value = s.level;
            sel.disabled = !isMyHost;
        }

        setVal('opt-hotjoin', s.allowHotJoin, true);
        setVal('opt-lives', s.startLives);
        setVal('opt-max-active', s.maxActiveEnemies);
        setVal('opt-bots-green', s.botsReserve[1]);
        setVal('opt-bots-red', s.botsReserve[2]);
        setVal('opt-bases', s.basesEnabled, true);
        setVal('opt-autonext', s.autoNextLevel, true);
    }
};