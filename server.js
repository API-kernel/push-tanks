import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// Настройка путей для ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Раздаем статические файлы из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище игроков (пока просто лог)
io.on('connection', (socket) => {
    console.log('Игрок подключился:', socket.id);

    socket.on('disconnect', () => {
        console.log('Игрок отключился:', socket.id);
    });
    
    // Тут мы будем слушать 'input' и отправлять 'state'
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});