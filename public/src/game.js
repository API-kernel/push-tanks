console.log("Загрузка game.js (CLIENT)...");

import { InputHandler } from './input.js';
import { drawHUD } from './ui.js';
import { audio } from './audio.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT, MAP_WIDTH, MAP_HEIGHT, PADDING, TILE_SIZE } from '../shared/config.js'; 
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
    isGameOver: false
};

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

    if (state.map) serverState.map = state.map;

    // 2. Звук Бонуса
    if (state.bonus && state.bonus.id !== lastBonusId) {
        audio.play('bonus_appear');
        lastBonusId = state.bonus.id;
    }
    if (!state.bonus && lastBonusId) {
        audio.play('bonus_take');
        lastBonusId = null;
    }
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
            const isIce = state.map && state.map[row] && state.map[row][col].type === 5;
            
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
                createExplosion(e.x, e.y, EXPLOSION_SMALL);
                if (isMine) audio.play('miss_hit');
            }
            else if (e.type === 'SHIELD_HIT') {
                createExplosion(e.x, e.y, EXPLOSION_SMALL);
                if (isMine) audio.play('brick_hit');
            }
            else if (e.type === 'HIT') {
                createExplosion(e.x, e.y, EXPLOSION_SMALL);
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
                createExplosion(e.x, e.y, EXPLOSION_BIG);
                if (e.isPlayer) audio.play('explosion_player');
                else audio.play('explosion_bot');
            }
            else if (e.type === 'BASE_DESTROY') {
                createExplosion(e.x, e.y, EXPLOSION_BIG);
                audio.play('base_crash');
                audio.play('game_over');
            }
            else if (e.type === 'ARMOR_HIT') {
                createExplosion(e.x, e.y, EXPLOSION_SMALL);
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
    const inputs = {};

    // P1: WASD / Space
    inputs[0] = {
        up: game.input.keys['KeyW'],
        down: game.input.keys['KeyS'],
        left: game.input.keys['KeyA'],
        pause: game.input.keys['KeyP'],
        right: game.input.keys['KeyD'],
        fire: game.input.keys['Space'],
        cheat0: game.input.keys['Digit0']
    };

    // P2: Arrows / Enter
    inputs[1] = {
        up: game.input.keys['ArrowUp'],
        down: game.input.keys['ArrowDown'],
        left: game.input.keys['ArrowLeft'],
        right: game.input.keys['ArrowRight'],
        fire: game.input.keys['Enter'],
        cheat0: false // Чит только у P1
    };

    socket.emit('input', inputs);
    updateExplosions();
}

function draw() {
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
    drawBases(ctx, game.sprites, serverState.bases); 
    

    drawBullets(ctx, game.sprites, serverState.bullets);
    drawEnemies(ctx, game.sprites, serverState.enemies, serverState.pendingSpawns);
    drawPlayers(ctx, game.sprites, serverState.players);
    drawExplosions(ctx, game.sprites);

    if (typeof drawForest === 'function') drawForest(ctx, game.sprites, serverState.map); 

    drawBonus(ctx, game.sprites, serverState.bonus); 

    ctx.restore();

    // 3. HUD
    // Передаем массив игроков (преобразуем из объекта)
    drawHUD(ctx, game.sprites, serverState.players);

    // 4. UI Game Over
    if (serverState.isGameOver) {

        let msg = "GAME OVER";
        let color = "red";
        let myTeam = 0;
        
        const me = Object.values(serverState.players).find(p => p.socketId === socket.id);
        if (me) myTeam = me.team;
        
        if (serverState.winnerTeamId) {
            if (serverState.winnerTeamId === myTeam) {
                msg = "VICTORY!";
                color = "gold";
            } else {
                msg = "DEFEAT";
                color = "red";
            }
        }

        ctx.save();
        ctx.translate(PADDING, PADDING); // Чтобы координаты совпадали с полем
        ctx.fillStyle = color;
        ctx.font = 'bold 20px Courier New';
        ctx.textAlign = 'center';
        // Центр ПОЛЯ, а не экрана
        ctx.fillText(msg, MAP_WIDTH / 2, MAP_HEIGHT / 2);
        ctx.restore();
    }

    if (!serverState.isGameOver) {
        ctx.fillStyle = "black";
        ctx.font = "8px \"Press Start 2P\""; // Или пиксельный
        ctx.textAlign = "center";
        ctx.fillText(`ROOM: ${currentRoomId}`, canvas.width / 2, 20);
    }
    
    const showNames = game.input.keys['Tab'] || (Date.now() - gameStartTime < 5000);
    let myTeam = 0;
    const me = Object.values(serverState.players).find(p => p.socketId === myId);
    if (me) myTeam = me.team;

    drawPlayerNames(uiCtx, serverState.players, showNames, serverState.map, myTeam);
}