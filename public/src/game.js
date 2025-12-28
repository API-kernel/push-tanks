import { initChat } from './chat.js';
import { InputHandler } from './input.js';
import { drawHUD } from './ui.js';
import { audio } from './audio.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT, MAP_WIDTH, MAP_HEIGHT, PADDING, TILE_SIZE, TILE_BIG_SIZE } from '../shared/config.js'; 
import { drawMapLayers, drawForest, drawBullets, drawPlayerNames,
     drawEnemies, drawPlayers, drawExplosions, 
     drawBases, drawBonus, updateExplosions, createExplosion,
    EXPLOSION_SMALL, EXPLOSION_BIG } from './renderer.js';

const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

const uiCanvas = document.getElementById('uiCanvas');
const uiCtx = uiCanvas.getContext('2d');
uiCanvas.width = CANVAS_WIDTH * 3;
uiCanvas.height = CANVAS_HEIGHT * 3;

const game = {
    sprites: new Image(),
    isLoaded: false,
    input: new InputHandler()
};



let serverState = {
    players: {},
    enemies: [],
    bullets: [],
    map: null,
    bases: [],
    bonus: null,
    winnerTeamId: null,
    isGameOver: false,
    settings: { level: 1, botsReserve: {1:20, 2:20} },
    botsSpawnedCount: { 1: 0, 2: 0 },
    teamWins: { 1: 0, 2: 0 } 
};

window.tankGameInput = game.input;

window.tankGame = {
    createRoom: (localCount, nicknames) => {
        socket.emit('create_room', { localCount, nicknames });
    },
    joinRoom: (roomId, localCount) => {
        socket.emit('join_room', { roomId, localCount });
    },
    requestStart: () => {
        socket.emit('start_game');
    },
    changeTeam: (localIndex, teamId) => {
        socket.emit('change_team', { localIndex, teamId });
    },
    quickPlay: (localCount, nicknames) => {
        socket.emit('quick_play', { localCount, nicknames});
    },
    changeName: (localIndex, name) => {
        socket.emit('change_nickname', { localIndex, name });
    },
    initAudio: () => audio.resume(),
    addLocalPlayer: () => socket.emit('add_local_player'),
    removeLocalPlayer: (idx) => socket.emit('remove_local_player', idx),
    updateSettings: (settings) => socket.emit('update_settings', settings)
};

let currentPing = 0;

setInterval(() => {
    socket.emit('latency_ping', Date.now());
}, 1000);

socket.on('latency_pong', (sentTime) => {
    currentPing = Date.now() - sentTime;
});

// --- СОБЫТИЯ ЛОББИ ---

socket.on('room_joined', (data) => {
    console.log("Joined Room:", data.roomId);
    currentRoomId = data.roomId;
    amIHost = data.isHost;
    if (window.showLobby) window.showLobby(data.roomId, data.isHost);
});

socket.on('lobby_update', (data) => {
     console.log("Lobby Update:", data.players); // <-- Добавь лог, посмотри, что приходит
    if (window.updateLobbyList) window.updateLobbyList(data.players);
});


window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') {
        socket.emit('toggle_pause');
    }
});


let gameStartTime = 0;
socket.on('game_start', () => {
    console.log("Game Started!");
    gameStartTime = Date.now();
    if (window.hideMenu) window.hideMenu();
    // Фокус на игру (чтобы клавиши работали)
    window.focus();
    audio.play('intro');
});

socket.on('error_msg', (msg) => {
    alert(msg);
});

socket.on('lobby_update', (data) => {
    // Теперь вызываем updateLobbyUI вместо updateLobbyList
    if (window.updateLobbyUI) window.updateLobbyUI(data);
});

let mapList = [];
socket.on('maps_list', (list) => {
    mapList = list;
    if (window.updateMapSelector) window.updateMapSelector(list);
});

let currentRoomId = "";
let amIHost = false;
socket.on('return_to_lobby', () => {
    console.log("Back to Lobby");
    if (window.showLobby) {
        window.showLobby(currentRoomId, amIHost); 
    }
    serverState.map = null; // Очищаем карту
});

// ... (код загрузки спрайтов и socket.on connect/map_init тот же) ...
game.sprites.onload = () => { game.isLoaded = true; requestAnimationFrame(loop); };
game.sprites.src = './assets/sprites.png';

let lastBonusId = null;

let myId = null;

if (socket.connected) {
    window.setMyId(socket.id);
}

socket.on('connect', () => {
    console.log("Connected:", socket.id);
    myId = socket.id;
    window.setMyId(socket.id);
    initChat(socket);

    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    if (roomCode) {
        const n1 = localStorage.getItem('tank_nick_p1') || "Player 1";
        socket.emit('join_room', { roomId: roomCode, localCount: 1, nicknames: [n1] });
        
        // Очищаем URL, чтобы при F5 не заходить вечно
        window.history.replaceState({}, document.title, "/");
    }
});

const prevMoving = {};

socket.on('state', (state) => {
    // 1. Обновление стейта
    serverState.players = state.players;
    serverState.enemies = state.enemies;
    serverState.bullets = state.bullets;
    serverState.bases = state.bases;
    serverState.isPaused = state.isPaused;
    serverState.isGameOver = state.isGameOver;
    serverState.winnerTeamId = state.winnerTeamId;
    serverState.pendingSpawns = state.pendingSpawns;
    serverState.players = state.players;
    serverState.enemies = state.enemies;

    if (state.map) serverState.map = state.map;

    // 2. Звук Бонуса

    if (state.settings) serverState.settings = state.settings;
    if (state.botsSpawnedCount) serverState.botsSpawnedCount = state.botsSpawnedCount;
    if (state.teamWins) serverState.teamWins = state.teamWins;

    serverState.bonus = state.bonus;

     // МОТОР
    if (state.isGameOver) {
        // Глушим всех
        Object.values(serverState.players).forEach(p => {
             audio.updateEngine(p.id, false); // false = idle -> pause?
             audio.stopEngine(p.id);
        });
    } else {
        Object.values(serverState.players).forEach(p => {
            if (p.socketId === socket.id) {
                if (!p.isDead && !p.isSpawning) {
                    audio.updateEngine(p.id, p.isMoving);
                } else {
                    audio.stopEngine(p.id);
                }
            }
        });
    }

    Object.values(state.players).forEach(p => {
        if (p.socketId === myId) {
            // ЛЕД
            const col = Math.floor((p.x + 8) / TILE_SIZE);
            const row = Math.floor((p.y + 8) / TILE_SIZE);
            const cell = state.map && state.map[row] && state.map[row][col];
            const isIce = cell && cell.type === 5;

            if(isIce){
                console.log(isIce)
            }
            
            const wasMoving = prevMoving[p.id] || false;
            
            // Старт движения на льду
            if (!wasMoving && p.isMoving && isIce) {
                audio.play('ice_skid'); // (добавь в audio.js)
            }
            
            prevMoving[p.id] = p.isMoving;
        }
    });

    // 3. События (Взрывы и Звуки)
    if (state.events && state.events.length > 0) {
        state.events.forEach(e => {
            // Хелпер: проверка, мое ли это событие
            // Проверяем, что ownerId это строка (у ботов это число) И что она начинается с моего socket.id
            const isMine = (typeof e.ownerId === 'string') && e.ownerId.startsWith(myId);

            if (e.type === 'WALL_HIT') {
                createExplosion(e.x + 2, e.y + 2, EXPLOSION_SMALL);
                if (isMine) audio.play('miss_hit');
            }
            else if (e.type === 'SHIELD_HIT') {
                createExplosion(e.x + 2, e.y + 2, EXPLOSION_SMALL);
                if (isMine) audio.play('brick_hit');
            }
            else if (e.type === 'HIT') {
                createExplosion(e.x + 2, e.y + 2, EXPLOSION_SMALL);
                if (isMine) {
                    if (e.isSteel) {
                        // Разрушил бетон?
                        audio.play('concrete_hit'); // Или звук разрушения
                    } else if (e.isSteelNoDmg) {
                        audio.play('miss_hit'); // Дзынь (не пробил)
                    } else {
                        audio.play('brick_hit');
                    }
                }
            }
            else if (e.type === 'TANK_EXPLODE') {
                createExplosion(e.x + 8, e.y + 8, EXPLOSION_BIG);
                if (e.isPlayer) audio.play('explosion_player');
                else audio.play('explosion_bot');
            }
            else if (e.type === 'BASE_DESTROY') {
                createExplosion(e.x + 8, e.y + 8, EXPLOSION_BIG);
                audio.play('base_crash');
                audio.play('game_over');
            }
            else if (e.type === 'ARMOR_HIT') {
                createExplosion(e.x + 8, e.y + 8, EXPLOSION_SMALL);
                audio.play('armor_hit');
            } 
            else if (e.type === 'PLAYER_FIRE') {
                if (isMine) {
                    audio.play('fire');
                }
            } 
            // События бонусов
            else if (e.type === 'BONUS_SPAWN') audio.play('bonus_appear');
            else if (e.type === 'BONUS_TAKEN') audio.play('bonus_take');
            else if (e.type === 'LIFE_UP') audio.play('life_up');
            else if (e.type === 'GRENADE_EXPLODE') audio.play('explosion_bot');
        });
    }
});

function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

function update() {
    const p2Id = `${myId}_1`;
    const p2Exists = serverState.players && serverState.players[p2Id];

    const inputs = game.input.getInputsPacket(!!p2Exists);
    socket.emit('input', inputs);

    game.showNames = game.input.isShowNamesPressed() || (Date.now() - gameStartTime < 5000);


    updateExplosions();
}

function draw() {
    const SCALE = 3; 
    
    // 1. Фон
    ctx.fillStyle = '#636363';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);

    if (!game.isLoaded || !serverState.map) {
        ctx.fillStyle = 'white';
        ctx.fillText("Connecting...", 100, 100);
        return;
    }

    if (serverState.isPaused) {
        uiCtx.save();
        uiCtx.font = 'bold 40px "Press Start 2P"'; // Большой
        uiCtx.fillStyle = '#e52424'; // Красный
        uiCtx.textAlign = 'center';
        uiCtx.textBaseline = 'middle';
        uiCtx.fillText("PAUSE", uiCanvas.width / 2, uiCanvas.height / 2);
        uiCtx.restore();
    }

    ctx.save();
    ctx.translate(PADDING, PADDING);

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    drawMapLayers(ctx, game.sprites, serverState.map, Date.now()); 
    drawBases(ctx, game.sprites, serverState.bases, serverState.settings); 
    

    drawBullets(ctx, game.sprites, serverState.bullets);
    drawEnemies(ctx, game.sprites, serverState.enemies, serverState.pendingSpawns);
    drawPlayers(ctx, game.sprites, serverState.players);
    drawExplosions(ctx, game.sprites);

    if (typeof drawForest === 'function') drawForest(ctx, game.sprites, serverState.map); 

    drawBonus(ctx, game.sprites, serverState.bonus); 

    ctx.restore();

    // 3. HUD
    // Передаем массив игроков (преобразуем из объекта)
    let myTeam = 0;
    const me = Object.values(serverState.players).find(p => p.socketId === myId);
    if (me) myTeam = me.team;

    const hudData = {
        players: serverState.players,
        enemies: serverState.enemies,
        pendingSpawns: serverState.pendingSpawns,
        settings: serverState.settings,
        botsSpawnedCount: serverState.botsSpawnedCount,
        myTeam: myTeam
    };

    drawHUD(ctx, game.sprites, hudData);

    // 4. UI Game Over
    if (serverState.isGameOver) {

        let msg = "GAME OVER";
        let color = "#e52424"; // Красный
        
        if (serverState.winnerTeamId) {
            if (serverState.winnerTeamId === myTeam) {
                msg = "VICTORY!";
                color = "#e6c629"; // Золотой (Желтый)
            } else {
                msg = "DEFEAT";
                color = "#e52424"; // Красный
            }
        }

        uiCtx.save();
        // Используем пиксельный шрифт, крупный размер (так как разрешение x3)
        uiCtx.font = 'bold 48px "Press Start 2P", monospace'; 
        uiCtx.textAlign = 'center';
        uiCtx.textBaseline = 'middle';

        // Вычисляем центр ИГРОВОГО ПОЛЯ с учетом масштаба UI
        // PADDING + Половина карты
        const centerX = (PADDING + MAP_WIDTH / 2) * SCALE;
        const centerY = (PADDING + MAP_HEIGHT / 2) * SCALE;

        // 1. Черная обводка (чтобы текст читался на фоне кирпичей)
        uiCtx.lineWidth = 8;
        uiCtx.strokeStyle = 'black';
        uiCtx.strokeText(msg, centerX, centerY);

        // 2. Цветной текст
        uiCtx.fillStyle = color;
        uiCtx.fillText(msg, centerX, centerY);
        
        uiCtx.restore();
    }


    uiCtx.save();
    uiCtx.fillStyle = "black";
    uiCtx.font = "bold 30px 'Press Start 2P', monospace"; // Крупный шрифт
    uiCtx.textAlign = "center";
    uiCtx.textBaseline = "top";
    
    // Координаты: Середина экрана, отступ 10px сверху
    const level = serverState.settings ? serverState.settings.level : 1;
    uiCtx.fillText(`STAGE:${level}`.toUpperCase(), (canvas.width / 2) * SCALE, 10 * SCALE + 20);
    uiCtx.restore();

    // Б) СЧЕТ ПОБЕД (Справа внизу, поверх HUD зоны)    
    const hudCenterX = (MAP_WIDTH + PADDING + 16) * SCALE;
    
    // Высота: Чуть выше нижней границы игрового поля (MAP_HEIGHT + PADDING)
    const hudY = (MAP_HEIGHT + PADDING - TILE_BIG_SIZE) * SCALE; 

    uiCtx.save();
    // Шрифт поменьше (было 36)
    uiCtx.font = 'bold 24px "Press Start 2P", monospace'; 
    uiCtx.textBaseline = 'middle';
    
    const score1 = serverState.teamWins[1];
    const score2 = serverState.teamWins[2];

    // 1. Желтые (Слева)
    uiCtx.textAlign = 'right';
    uiCtx.fillStyle = '#E79C21'; 
    uiCtx.fillText(score1, hudCenterX - 12, hudY);

    // 2. Двоеточие (Центр)
    uiCtx.textAlign = 'center';
    uiCtx.fillStyle = 'black'; // Белый цвет для разделителя
    uiCtx.fillText(":", hudCenterX, hudY); // Чуть выше визуально

    // 3. Зеленые (Справа)
    uiCtx.textAlign = 'left';
    uiCtx.fillStyle = '#008C31'; 
    uiCtx.fillText(score2, hudCenterX + 10, hudY);

    // 2. ПИНГ (Рисуем под счетом)
    const pingY = (MAP_HEIGHT + PADDING - 3) * SCALE;
    
    uiCtx.font = '10px "Press Start 2P", monospace'; // Мелкий шрифт
    uiCtx.textAlign = 'center';
    
    // Цвет зависит от качества связи
    if (currentPing < 100) uiCtx.fillStyle = 'black'; // Зеленый (Хорошо)
    else if (currentPing < 200) uiCtx.fillStyle = '#e6c629'; // Желтый (Средне)
    else uiCtx.fillStyle = '#e52424'; // Красный (Плохо)

    uiCtx.fillText(`PING: ${currentPing}`, hudCenterX, pingY);


    uiCtx.restore();
    
    drawPlayerNames(uiCtx, serverState.players, game.showNames, serverState.map, myTeam);
}