let localPlayersCount = 1;
let isMyHost = false;

let mySocketId = null; // Нужно сохранить ID сокета (передадим из game.js)

// Вызывается из game.js при подключении
window.setMyId = (id) => { mySocketId = id; };

// Функция смены команды (отправляет на сервер)
window.changeTeam = (localIndex, teamId) => {
    if (window.tankGame) window.tankGame.changeTeam(localIndex, teamId);
};

window.toggleDonate = (show) => {
    const modal = document.getElementById('donate-modal');
    modal.style.display = show ? 'flex' : 'none';
};

window.changeSettings = () => {
    const level = document.getElementById('opt-level-select').value;
    const lives = parseInt(document.getElementById('opt-lives').value);
    
    const maxActiveTanks = parseInt(document.getElementById('opt-max-active').value);
    
    const botsGreen = parseInt(document.getElementById('opt-bots-green').value);
    const botsRed = parseInt(document.getElementById('opt-bots-red').value);
    const hotjoin = document.getElementById('opt-hotjoin').checked;
    const bases = document.getElementById('opt-bases').checked;
    const autonext = document.getElementById('opt-autonext').checked;
    const vibranium = document.getElementById('opt-vibranium').checked;
    const botVersion = document.getElementById('opt-bot-ai').value;

    if (window.tankGame) {
        window.tankGame.updateSettings({ 
            level, 
            startLives: lives, 
            maxActiveTanks: maxActiveTanks,
            basesEnabled: bases,
            vibraniumBase: vibranium,
            botVersion,
            autoNextLevel: autonext,
            botsReserve: { 1: botsGreen, 2: botsRed },
            allowHotJoin: hotjoin 
        });
    }
};

window.addEventListener('load', () => {
    const savedName = localStorage.getItem('tank_nick_p1');
    const input = document.getElementById('menu-nickname');
    if (input) {
        input.value = savedName || "PLAYER";
    }
});

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
    document.getElementById('chat-container').style.display = 'none';
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

window.copyLink = (btnElement) => {
    const url = window.location.origin + window.location.pathname + '?room=' + currentRoomId;
    navigator.clipboard.writeText(url).then(() => {
        // Анимация успеха
        const original = btnElement.innerHTML; // "🔗"
        
        btnElement.innerHTML = "✔"; // Галочка
        btnElement.classList.add('copied'); // Зеленый стиль
        
        setTimeout(() => {
            btnElement.innerHTML = original;
            btnElement.classList.remove('copied');
        }, 1500);
    });
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
                 val = localStorage.getItem(`tank_nick_p${p.localIndex+1}`) || `P${p.localIndex+1}`;
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
            nameHtml = `<span class="lobby-name-text" style="color:${p.team === 1 ? '#e6c629' : '#63db44'}">${p.nickname || 'Unknown'}</span>`;
        }

        // 2. КОЛОНКА КНОПОК
        let actionsHtml = '';
        
        if (isMe) {
            // Кнопки команд с подсветкой
            const yClass = p.team === 1 ? 'team-btn team-btn-yellow active' : 'team-btn team-btn-yellow';
            const gClass = p.team === 2 ? 'team-btn team-btn-green active' : 'team-btn team-btn-green';
            const sClass = p.team === 0 ? 'team-btn team-btn-gray active' : 'team-btn team-btn-gray';

            actionsHtml += `<button class="${yClass}" onclick="changeTeam(${p.localIndex}, 1)">YELLOW</button>`;
            actionsHtml += `<button class="${gClass}" onclick="changeTeam(${p.localIndex}, 2)">GREEN</button>`;
            actionsHtml += `<button class="${sClass}" onclick="changeTeam(${p.localIndex}, 0)">👁</button>`;

            // Кнопка удаления
            if (p.localIndex > 0) {
                actionsHtml += `<button class="btn-remove" onclick="removeLocalPlayer(${p.localIndex})">×</button>`;
            } else {
                actionsHtml += `<div class="btn-placeholder"></div>`; // Пустое место для выравнивания
            }
        } else {
            if (p.team === 0) {
                 actionsHtml = `<span class="team-label" style="color: #aaa; font-weight: bold;">SPECTATOR</span>`;
            } else {
                const color = p.team === 1 ? '#e6c629' : '#63db44';
                const label = p.team === 1 ? 'YELLOW' : 'GREEN';
                actionsHtml = `<span class="team-label" style="color: ${color}; font-weight: bold;">${label}</span>`;
            }
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

let currentRoomId = "";
// Функции для управления экранами (вызываются из game.js)
window.showLobby = (roomId, isHost) => {
    console.log("Show Lobby. Host:", isHost);
    isMyHost = isHost;
    currentRoomId = roomId;
    
    document.getElementById('menu-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'flex';
    document.getElementById('display-room-id').innerText = roomId;
    document.getElementById('chat-container').style.display = 'flex';
    
    document.getElementById('btn-start').style.display = 'block';
};

window.hideMenu = () => {
    document.getElementById('menu-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'none';
};

window.quickPlay = () => {
    if (window.tankGame) {
        window.tankGame.initAudio();
        window.tankGame.quickPlay(localPlayersCount, getNicknames());
    }
};

function changeSettings() {
    if (!isMyHost) return;

    const level = parseInt(document.getElementById('opt-level').value);
    const bots = document.getElementById('opt-bots').checked;
    const hotjoin = document.getElementById('opt-hotjoin').checked; // Новая галочка

    if (window.tankGame) {
        window.tankGame.updateSettings({ 
            level, 
            startLives: lives, 
            maxActiveTanks: maxActive,
            botsEnabled: bots,
            allowHotJoin: hotjoin 
        });
    }
}

let targetRoomId = null; // Запоминаем ID комнаты из ссылки

window.initJoinMode = (code) => {
    targetRoomId = code;
    
    // 1. Находим кнопку CREATE ROOM
    const createBtn = document.querySelector('button[onclick="createRoom()"]');
    const quickBtn = document.querySelector('button[onclick="quickPlay()"]');
    
    if (createBtn) {
        createBtn.innerText = `JOIN ROOM ${code}`;
        createBtn.style.borderColor = "#fca048"; // Оранжевый
        createBtn.style.color = "#fca048";
        createBtn.style.animation = "pulse 2s infinite";
        
        // Переопределяем клик
        createBtn.onclick = () => {
            joinSpecificRoom(code);
        };
    }
    
    // Скрываем Quick Play, чтобы не отвлекала (опционально)
    if (quickBtn) {
        quickBtn.style.display = 'none';
    }
};

function joinSpecificRoom(code) {
    // Эта функция похожа на quickPlay, но с конкретным ID
    if (window.tankGame) {
        window.tankGame.initAudio();
        // Используем наш хелпер для ников
        window.tankGame.joinRoom(code, localPlayersCount, getNicknames()); 
        
        // Очищаем URL, чтобы при F5 не предлагало снова
        window.history.replaceState({}, document.title, "/");
    }
}

function getNicknames() {
    // 1. Пытаемся взять из инпута
    const input = document.getElementById('menu-nickname');
    let n1 = input ? input.value.trim() : "";

    // 2. Если пусто — берем из памяти или дефолт
    if (!n1) {
        n1 = localStorage.getItem('tank_nick_p1') || "PLAYER";
    }

    // 3. Сохраняем актуальное (чтобы при рефреше осталось)
    localStorage.setItem('tank_nick_p1', n1);

    // 4. Второй игрок (у него нет инпута в главном меню, берем из памяти)
    const n2 = localStorage.getItem('tank_nick_p2') || "PLAYER 2";
    
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
            
            el.disabled = false;
        };
        
        const sel = document.getElementById('opt-level-select');
        if (sel) {
            sel.value = s.level;
            sel.disabled = false;
        }

        setVal('opt-hotjoin', s.allowHotJoin, true);
        setVal('opt-lives', s.startLives);
        setVal('opt-max-active', s.maxActiveTanks);
        setVal('opt-bots-green', s.botsReserve[1]);
        setVal('opt-bots-red', s.botsReserve[2]);
        setVal('opt-bases', s.basesEnabled, true);
        setVal('opt-autonext', s.autoNextLevel, true);
        setVal('opt-vibranium', s.vibraniumBase, true);
        setVal('opt-bot-ai', s.botVersion || 'tactical-v1');
    }
};