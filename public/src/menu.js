let localPlayersCount = 1;
let isMyHost = false;

// Инициализация UI
window.onload = () => {
    selectLocalPlayers(1);
};

let mySocketId = null; // Нужно сохранить ID сокета (передадим из game.js)

// Вызывается из game.js при подключении
window.setMyId = (id) => { mySocketId = id; };

// Функция смены команды (отправляет на сервер)
window.changeTeam = (localIndex, teamId) => {
    if (window.tankGame) window.tankGame.changeTeam(localIndex, teamId);
};

window.changeSettings = () => {
    if (!isMyHost) return; // Только хост может менять

    const level = parseInt(document.getElementById('opt-level').value);
    const bots = document.getElementById('opt-bots').checked;

    if (window.tankGame) {
        window.tankGame.updateSettings({ level, botsEnabled: bots });
    }
};

window.updateLobbyUI = (data) => {
    // data = { players, settings }
    
    // 1. Обновляем список игроков (старая функция)
    updateLobbyList(data.players);

    // 2. Обновляем Настройки
    if (data.settings) {
        const lvlInput = document.getElementById('opt-level');
        const botsInput = document.getElementById('opt-bots');

        // Если я НЕ хост, я обновляю свои инпуты значениями с сервера
        // Если я ХОСТ, я не обновляю, чтобы курсор не прыгал (хотя можно и обновить)
        if (!isMyHost) {
            lvlInput.value = data.settings.level;
            botsInput.checked = data.settings.botsEnabled;
            
            // Блокируем для не-хоста
            lvlInput.disabled = true;
            botsInput.disabled = true;
        } else {
            lvlInput.disabled = false;
            botsInput.disabled = false;
        }
    }
};

window.updateLobbyList = (players) => {
    const container = document.getElementById('lobby-players');
    container.innerHTML = '';

    // Считаем моих игроков
    let myCount = 0;
    Object.values(players).forEach(p => {
        if (p.socketId === mySocketId) myCount++;
    });

    Object.values(players).forEach(p => {
        const div = document.createElement('div');
        div.className = 'lobby-player-row';
        div.style.color = (p.team === 1) ? '#63db44' : '#d43333';
        
        const isMe = p.socketId === mySocketId;
        const name = isMe ? `YOU (P${p.localIndex + 1})` : `PLAYER ${p.playerIndex + 1}`;
        
        let html = `<span>${name}</span>`;
        
        if (isMe) {
            // Выбор команды
            html += `
                <button onclick="changeTeam(${p.localIndex}, 1)" ${p.team===1?'disabled':''}>GREEN</button>
                <button onclick="changeTeam(${p.localIndex}, 2)" ${p.team===2?'disabled':''}>RED</button>
            `;
            // Кнопка удаления (только для P2)
            if (p.localIndex > 0) {
                html += `<button onclick="removeLocalPlayer(${p.localIndex})" style="color:red;">X</button>`;
            }
        } else {
            html += `<span>${p.team === 1 ? 'GREEN' : 'RED'}</span>`;
        }
        
        div.innerHTML = html;
        container.appendChild(div);
    });

    // Кнопка добавления (если у меня < 2 игроков)
    if (myCount < 2) {
        const addBtn = document.createElement('div');
        addBtn.innerHTML = `<button onclick="addLocalPlayer()">+ ADD PLAYER 2</button>`;
        container.appendChild(addBtn);
    }
};

window.addLocalPlayer = () => {
    if (window.tankGame) window.tankGame.addLocalPlayer();
};

window.removeLocalPlayer = (idx) => {
    if (window.tankGame) window.tankGame.removeLocalPlayer(idx);
};

function selectLocalPlayers(n) {
    localPlayersCount = n;
    document.getElementById('btn-1p').classList.toggle('selected', n === 1);
    document.getElementById('btn-2p').classList.toggle('selected', n === 2);
}

function createRoom() {
    // Вызываем функцию из game.js (нам нужно экспортировать её или повесить на window)
    // Так как game.js - модуль, мы не можем просто вызвать функцию оттуда.
    // Решение: game.js при старте повесит свои методы на window.tankGame
    if (window.tankGame) {
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