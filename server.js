import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameRoom } from './game_room.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { perMessageDeflate: { threshold: 1024 } });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// Хранилище комнат { "ABCD": GameRoom }
const rooms = {};

const mapsDir = path.join(__dirname, 'shared', 'maps');
let availableMaps = [];

if (fs.existsSync(mapsDir)) {
    const files = fs.readdirSync(mapsDir);
    availableMaps = files
        .filter(f => f.endsWith('.json')) // Ищем .json
        .map(f => path.basename(f, '.json'))
        .sort((a, b) => {
            // Сортировка: числа, потом строки
            const nA = parseInt(a);
            const nB = parseInt(b);
            if (!isNaN(nA) && !isNaN(nB)) return nA - nB;
            return a.localeCompare(b);
        });
    console.log("Maps found:", availableMaps);
}

function generateRoomId() {
    let result = '';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Без I, O, 0, 1 для читаемости
    for (let i = 0; i < 3; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result.toUpperCase();
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.emit('maps_list', availableMaps);

    // Переменная, хранящая ID комнаты для ЭТОГО сокета
    let currentRoomId = null;

    // --- ЛОББИ ---

    // 1. Создать комнату
    socket.on('create_room', (config) => {
        const roomId = generateRoomId();
        const room = new GameRoom(roomId, io, availableMaps);
        room.hostSocketId = socket.id;
        rooms[roomId] = room;
        
        // Вход в комнату (общая логика)
        joinRoomLogic(socket, roomId, config.localCount || 1, true, config.nicknames); // true = isHost
    });

    // 2. Войти в комнату
    socket.on('join_room', (data) => {
        let roomId = (data.roomId || "").toUpperCase();
        
        // Валидация длины (макс 5)
        if (roomId.length > 5) roomId = roomId.substring(0, 5);
        if (roomId.length < 2) { socket.emit('error_msg', "Invalid ID"); return; }
        
        let room = rooms[roomId];

        if (!room) {
            console.log("Room not found, creating:", roomId);
            room = new GameRoom(roomId, io, availableMaps);
            rooms[roomId] = room;
            joinRoomLogic(socket, roomId, data.localCount || 1, true, data.nicknames);
            return;
        }
        
        // Проверка Hot-Join
        if (room.isRunning && !room.settings.allowHotJoin) {
            socket.emit('error_msg', "Game in progress (Locked)"); 
            return;
        }
        
        joinRoomLogic(socket, roomId, data.localCount || 1, false, data.nicknames);
    });

    // 3. Quick Play (Матчмейкинг)
    socket.on('quick_play', (config) => {
        const localCount = config.localCount || 1;
        const nicknames = config.nicknames || [];
        let targetRoomId = null;
        
        for (const id in rooms) {
            const r = rooms[id];
            
            // Можем ли мы подключиться технически?
            const canConnect = r.isRunning && r.settings.allowHotJoin;
            if (!canConnect) continue;
            
            const limit = r.settings.maxActiveTanks;
            const c1 = r.getTeamPlayerCount(1);
            const c2 = r.getTeamPlayerCount(2);
            
            const hasSlot1 = (c1 + localCount <= limit);
            const hasSlot2 = (c2 + localCount <= limit);
            
            if (hasSlot1 || hasSlot2) {
                targetRoomId = id;
                break; 
            }
        }
        
        if (targetRoomId) {
            joinRoomLogic(socket, targetRoomId, localCount, false, nicknames);
        } else {
            // Создаем новую
            let randomMap = '1';
            if (availableMaps.length > 0) {
                const randomIndex = Math.floor(Math.random() * availableMaps.length);
                randomMap = availableMaps[randomIndex];
            }
            createRoomLogic(socket, localCount, true, nicknames, randomMap);
        }
    });

    // Хелпер входа (чтобы не дублировать)
    function joinRoomLogic(socket, roomId, localCount, isHost, nicknames = []) {
        currentRoomId = roomId;
        const room = rooms[roomId];
        socket.join(roomId);

        // Добавляем игроков
        for(let i=0; i<localCount; i++) {
            const name = nicknames[i] || `P${i+1}`;
            room.addPlayer(socket.id, i, name);
        }

        socket.emit('room_joined', { roomId, isHost });
        
        if (room.isRunning) {
            socket.emit('game_start');
            socket.emit('map_init', room.map);
            // Шлем апдейт лобби (чтобы обновились списки у других)
            io.to(roomId).emit('lobby_update', { players: room.players, settings: room.settings });
        } else {
            io.to(roomId).emit('lobby_update', { players: room.players, settings: room.settings });
        }
    }

    function createRoomLogic(socket, localCount, autoStart = false, nicknames = [], startLevel = null) {
        const roomId = generateRoomId();
        const room = new GameRoom(roomId, io, availableMaps);
        room.hostSocketId = socket.id;
        rooms[roomId] = room;

        if (startLevel && availableMaps.includes(String(startLevel))) {
            room.settings.level = startLevel;
        }
        
        joinRoomLogic(socket, roomId, localCount, true, nicknames); // true = isHost
        
        if (autoStart) {
            room.startGame();
        }
    }

    // 4. Смена Команды
    socket.on('change_team', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const uniqueId = `${socket.id}_${data.localIndex}`;
        const targetTeam = data.teamId;
        
        if (room.players[uniqueId]) {
            // Если хотим в зрители (0) — всегда пускаем
            if (targetTeam === 0) {
                room.players[uniqueId].team = 0;
                 // Обнуляем параметры, чтобы не висел "призрак"
                room.players[uniqueId].isDead = true;
                room.players[uniqueId].x = -1000;
                
                io.to(currentRoomId).emit('lobby_update', { players: room.players, settings: room.settings });
                return;
            }

            // Если хотим в Игру (1 или 2) — проверяем лимит
            const limit = room.settings.maxActiveTanks;
            const currentCount = room.getTeamPlayerCount(targetTeam);
            
            if (currentCount < limit) {
                room.players[uniqueId].team = targetTeam;
                
                // Обновляем направление (если нужно для респавна)
                const teamConfig = room.teamManager.getTeam(targetTeam);
                if (teamConfig) room.players[uniqueId].direction = teamConfig.direction;
                
                io.to(currentRoomId).emit('lobby_update', { players: room.players, settings: room.settings });
            } else {
                socket.emit('error_msg', 'TEAM IS FULL!');
            }
        }
    });

    socket.on('change_nickname', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const uniqueId = `${socket.id}_${data.localIndex}`;
        
        if (room.players[uniqueId]) {
            // Обрезаем, чтобы не ломать верстку
            room.players[uniqueId].nickname = (data.name || "").substring(0, 10).toUpperCase();
            io.to(currentRoomId).emit('lobby_update', { 
                players: room.players, 
                settings: room.settings 
            });
        }
    });

    // 5. Настройки
    socket.on('update_settings', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        rooms[currentRoomId].updateSettings(data);
        io.to(currentRoomId).emit('lobby_update', { 
            players: rooms[currentRoomId].players,
            settings: rooms[currentRoomId].settings 
        });
    });

    // 6. Добавить локального игрока
    socket.on('add_local_player', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        
        let count = 0;
        for (const id in room.players) {
            if (room.players[id].socketId === socket.id) count++;
        }
        
        if (count < 2) {
            room.addPlayer(socket.id, count); // count = 1
            io.to(currentRoomId).emit('lobby_update', { players: room.players, settings: room.settings });
        }
    });

    // 7. Удалить локального игрока
    socket.on('remove_local_player', (localIndex) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        
        if (localIndex > 0) {
            room.removeLocalPlayer(socket.id, localIndex);
            io.to(currentRoomId).emit('lobby_update', { players: room.players, settings: room.settings });
        }
    });

    socket.on('toggle_pause', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        
        // Проверка Хоста
        if (room.hostSocketId === socket.id) {
            room.togglePause();
        }
    });

    // 8. СТАРТ
    socket.on('start_game', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        rooms[currentRoomId].startGame();
    });

    // --- GAMEPLAY ---

    socket.on('input', (data) => {
        if (currentRoomId && rooms[currentRoomId]) {
            rooms[currentRoomId].handleInput(socket.id, data);
        }
    });

    socket.on('chat_message', (data) => {
        if (currentRoomId && rooms[currentRoomId]) {
            rooms[currentRoomId].handleChat(socket.id, data.text);
        }
    });

    socket.on('disconnect', () => {
        console.log('Disconnected:', socket.id);
        if (currentRoomId && rooms[currentRoomId]) {
            rooms[currentRoomId].removePlayer(socket.id);
            
            // Если комната пуста - удаляем (через таймаут или сразу)
            if (Object.keys(rooms[currentRoomId].players).length === 0) {
                rooms[currentRoomId].destroy(); // Остановить таймер
                delete rooms[currentRoomId];
                console.log("Room destroyed:", currentRoomId);
            } else {
                io.to(currentRoomId).emit('lobby_update', { players: rooms[currentRoomId].players, settings: rooms[currentRoomId].settings });
            }
        }
    });
});

const PORT = 3000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));