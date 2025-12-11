import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameRoom } from './game_room.js'; // Используем src/game_room.js

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// Хранилище комнат { "ABCD": GameRoomInstance }
const rooms = {};

// Хелпер: Генерация ID комнаты (4 буквы)
function generateRoomId() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    let currentRoomId = null;

    // --- ЛОББИ СОБЫТИЯ ---

    // 1. Создать Комнату
    socket.on('create_room', (config) => {
        // config = { localCount: 1 or 2 }
        const roomId = generateRoomId();
        const room = new GameRoom(roomId, io);
        
        rooms[roomId] = room;
        currentRoomId = roomId;
        
        socket.join(roomId);
        
        // Добавляем игроков хоста
        const count = config.localCount || 1;
        for(let i=0; i<count; i++) room.addPlayer(socket.id, i);

        // Сообщаем клиенту: "Ты в комнате ABCD, ты Хост"
        socket.emit('room_joined', { roomId, isHost: true });
        
        // Шлем обновление списка (пока пустое, так как игра не запущена)
        // Но нам нужно знать список игроков В ЛОББИ.
        // GameRoom хранит players сразу. Можно слать их.
        io.to(roomId).emit('lobby_update', { players: room.players });
    });

    // 2. Войти в Комнату
    socket.on('join_room', (data) => {
        const roomId = data.roomId;
        const room = rooms[roomId];

        if (!room) {
            socket.emit('error_msg', "Room not found!");
            return;
        }
        
        // Если игра уже идет - можно ли войти? (Hot Join)
        // Да, мы это обсуждали.
        
        currentRoomId = roomId;
        socket.join(roomId);

        const count = data.localCount || 1;
        for(let i=0; i<count; i++) room.addPlayer(socket.id, i);

        socket.emit('room_joined', { roomId, isHost: false });
        io.to(roomId).emit('lobby_update', { players: room.players });
        
        // Если игра УЖЕ идет - нужно сразу слать map_init и state
        // Как узнать, идет ли игра? Добавим флаг isRunning в GameRoom?
        // Или просто interval запущен всегда? (У нас он запущен в конструкторе).
        // Значит игра идет всегда. Шлем карту.
        if (room.isRunning) {
            // Hot Join: Игра идет, сразу кидаем в бой
            socket.emit('game_start'); // Скрыть меню
            socket.emit('map_init', room.map);
        } else {
            // Cold Join: Ждем в лобби
            // (game_start не шлем, клиент видит экран лобби)
        }
    });

    // 3. Старт Игры (Например, разморозка или рестарт)
    socket.on('start_game', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        // Тут можно сделать рестарт уровня, чтобы все начали одновременно
        rooms[currentRoomId].startGame();
        io.to(currentRoomId).emit('game_start');
    });

    // --- ИГРОВЫЕ СОБЫТИЯ ---

    socket.on('input', (data) => {
        if (currentRoomId && rooms[currentRoomId]) {
            rooms[currentRoomId].handleInput(socket.id, data);
        }
    });

    socket.on('disconnect', () => {
        if (currentRoomId && rooms[currentRoomId]) {
            rooms[currentRoomId].removePlayer(socket.id);
            // Если комната пуста - удаляем
            // Но как проверить? Object.keys(rooms[roomId].players).length
            // Это сделаем позже для очистки памяти.
            io.to(currentRoomId).emit('lobby_update', { players: rooms[currentRoomId].players });
        }
    });

    socket.on('change_team', (data) => {
        // data = { localIndex: 0, teamId: 2 }
        if (!currentRoomId || !rooms[currentRoomId]) return;
        
        const room = rooms[currentRoomId];
        const uniqueId = `${socket.id}_${data.localIndex}`;
        
        if (room.players[uniqueId]) {
            room.players[uniqueId].team = data.teamId;
            
            const teamConfig = room.teamManager.getTeam(data.teamId);
            if (teamConfig) room.players[uniqueId].direction = teamConfig.direction;
            
            io.to(currentRoomId).emit('lobby_update', { players: room.players });
        }
    });

    socket.on('add_local_player', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        
        let count = 0;
        for (const id in room.players) {
            if (room.players[id].socketId === socket.id) count++;
        }
        
        if (count < 2) {
            room.addPlayer(socket.id, count); // count будет 1
            io.to(currentRoomId).emit('lobby_update', { players: room.players });
        }
    });

    socket.on('remove_local_player', (localIndex) => {
            if (!currentRoomId || !rooms[currentRoomId]) return;
            
            const room = rooms[currentRoomId];
            
            if (localIndex > 0) {
                room.removeLocalPlayer(socket.id, localIndex);
                io.to(currentRoomId).emit('lobby_update', { players: room.players });
            }
        });

    socket.on('update_settings', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        
        const room = rooms[currentRoomId];
        
        room.updateSettings(data);
        
        io.to(currentRoomId).emit('lobby_update', { 
            players: room.players,
            settings: room.settings
        });
    });
});

const PORT = 3000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));