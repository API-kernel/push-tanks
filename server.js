import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameRoom } from './game_room.js'; // <--- Исправлено

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

const rooms = {};
const defaultRoomId = 'public';
rooms[defaultRoomId] = new GameRoom(defaultRoomId, io);

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    const roomId = defaultRoomId;
    socket.join(roomId);
    
    socket.on('join_game', (config) => {
        const count = config.count || 1;
        for (let i = 0; i < count; i++) {
            rooms[roomId].addPlayer(socket.id, i);
        }
    });

    socket.on('input', (data) => {
        rooms[roomId].handleInput(socket.id, data);
    });

    socket.on('disconnect', () => {
        rooms[roomId].removePlayer(socket.id);
    });
});

const PORT = 3000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));