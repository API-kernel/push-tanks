import net from 'net';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameRoom } from './game_room.js';
import fs from 'fs';
import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from './shared/config.js'; // Импортируем константы

// --- ГЛОБАЛЬНЫЕ ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TCP_PORT = process.argv[2] ? parseInt(process.argv[2]) : 4000;
const IS_LEADER = (TCP_PORT === 4000);
const WEB_PORT = 3001;

const AGENT_SOCKET_ID = "AI_AGENT";
const AGENT_ID = `${AGENT_SOCKET_ID}_0`;

// --- СЕРВЕР И КОМНАТА ---
let io = null;
let httpServer = null;

if (IS_LEADER) {
    const app = express();
    httpServer = createServer(app);
    io = new Server(httpServer, { cors: { origin: "*" } });
    app.use(express.static(path.join(__dirname, 'public')));
    app.use('/shared', express.static(path.join(__dirname, 'shared')));
    console.log(`🎥 Debugger: http://localhost:${WEB_PORT}/?room=TRAIN_${TCP_PORT}`);
} else {
    console.log(`🔇 Worker: ${TCP_PORT}`);
}

const room = new GameRoom(`TRAIN_${TCP_PORT}`, io);

// Отключаем стандартный спавнер ботов движка
room.settings.maxActiveTanks = 0; 
room.settings.startLives = 0;
room.settings.vibraniumBase = false;
room.settings.basesEnabled = false;

// --- ХЕЛПЕРЫ СПАВНА ---

// Найти случайную свободную точку (16x16)
function getRandomFreePosition() {
    const cols = Math.floor(MAP_WIDTH / TILE_SIZE) - 2;
    const rows = Math.floor(MAP_HEIGHT / TILE_SIZE) - 2;
    
    let attempts = 0;
    while (attempts < 100) {
        const x = (Math.floor(Math.random() * cols) + 1) * TILE_SIZE;
        const y = (Math.floor(Math.random() * rows) + 1) * TILE_SIZE;
        
        // 1. Проверка стен (упрощенная, центр)
        const r = Math.floor((y + 8) / TILE_SIZE);
        const c = Math.floor((x + 8) / TILE_SIZE);
        
        // Если карта загружена и в центре блок не пустой (и не лес)
        if (room.map && room.map[r] && room.map[r][c]) {
            const t = room.map[r][c].type;
            if (t === 1 || t === 2 || t === 4) { // Кирпич, Бетон, Вода
                attempts++;
                continue;
            }
        }

        // 2. Проверка коллизий с другими танками
        const rect = { x, y, width: 16, height: 16 };
        let collision = false;
        
        // Проверяем игрока
        const p = room.players[AGENT_ID];
        if (p && !p.isDead) {
            if (Math.abs(p.x - x) < 16 && Math.abs(p.y - y) < 16) collision = true;
        }
        
        // Проверяем врагов
        for (const e of room.enemies) {
            if (Math.abs(e.x - x) < 16 && Math.abs(e.y - y) < 16) collision = true;
        }

        if (!collision) return { x, y };
        attempts++;
    }
    return { x: 100, y: 100 }; // Фоллбэк
}

// Спавн манекена
function spawnDummyBot(enemyTeam) {
    const pos = getRandomFreePosition();
    room.enemies.push({
        id: room.enemyIdCounter++,
        team: enemyTeam, // Враг (мы всегда Team 1 в этом режиме)
        x: pos.x,
        y: pos.y,
        width: 16, 
        height: 16,
        direction: ['UP', 'DOWN', 'LEFT', 'RIGHT'][Math.floor(Math.random()*4)], // Случайный поворот
        speed: 0, // Не едет
        hp: 1,
        type: 'basic',     
        spriteKey: 'basic',
        isMoving: false,
        bulletTimer: 999999, // Не стреляет
        frameIndex: 0,
        frameTimer: 0,
        isBonus: false
    });
}

// --- ОТРИСОВКА ---
let lastBroadcastTime = 0;
function tryBroadcast() {
    if (!IS_LEADER || !io) return;
    const now = Date.now();
    if (now - lastBroadcastTime > 50) {
        room.broadcastState();
        lastBroadcastTime = now;
    }
}

// --- СТАТИСТИКА И НАГРАДА ---
let episodeStats = { steps: 0, kills: 0, shots: 0, startPos: {x:0,y:0} };

// Хелпер: Смотрю ли я на врага? (Raycast / Луч зрения)
function checkLineOfSight(agentId) {
    const player = room.players[agentId];
    if (!player || player.isDead) return false;

    // Центр танка в координатах сетки (8x8)
    const rStart = Math.floor((player.y + 8) / 8);
    const cStart = Math.floor((player.x + 8) / 8);
    
    // Вектор направления (куда летит пуля)
    let dr = 0, dc = 0;
    if (player.direction === 'UP') dr = -1;
    else if (player.direction === 'DOWN') dr = 1;
    else if (player.direction === 'LEFT') dc = -1;
    else if (player.direction === 'RIGHT') dc = 1;

    // Пускаем луч вперед
    let r = rStart + dr;
    let c = cStart + dc;
    
    // Проверяем на 25 клеток вперед (практически через всю карту)
    for (let i = 0; i < 25; i++) {
        // 1. Проверка выхода за границы карты
        if (r < 0 || r >= 26 || c < 0 || c >= 26) break;

        // 2. Проверка Стен
        // Если в клетке есть блок
        if (room.map[r][c] && room.map[r][c].type !== 0) {
            const t = room.map[r][c].type;
            // 1=Кирпич, 2=Бетон -> Блокируют обзор/выстрел.
            // 3=Лес, 4=Вода, 5=Лед -> Простреливаются, луч идет дальше.
            if (t === 1 || t === 2) return false;
        }

        // 3. Проверка Ботов (enemies)
        // Танк занимает 2x2 клетки (16px), поэтому проверяем, попадает ли луч в радиус 1 клетки от центра врага
        const hitEnemy = room.enemies.find(e => {
            const er = Math.floor((e.y + 8) / 8);
            const ec = Math.floor((e.x + 8) / 8);
            return Math.abs(er - r) <= 1 && Math.abs(ec - c) <= 1;
        });

        if (hitEnemy) return true; // УРА! На линии огня враг.

        // 4. Проверка Игроков-врагов (если тренируемся против другой нейросети или игрока)
        const hitPlayer = Object.values(room.players).find(p => {
            // Исключаем себя, мертвых и союзников
            if (p.id !== agentId && !p.isDead && p.team !== player.team) {
                const pr = Math.floor((p.y + 8) / 8);
                const pc = Math.floor((p.x + 8) / 8);
                return Math.abs(pr - r) <= 1 && Math.abs(pc - c) <= 1;
            }
            return false;
        });

        if (hitPlayer) return true; // УРА! На линии огня игрок-враг.

        // Шагаем дальше
        r += dr;
        c += dc;
    }
    
    return false; // Никого не встретили или уперлись в стену
}

function calculateReward(agentId) {
    let reward = 0.0;
    const player = room.players[agentId];
    if (!player) return 0;

    // 1. Штраф за время (Time Penalty)
    // Чтобы убивал быстрее. -0.01 за каждый тик.
    reward -= 0.01; 

        // 3. ПРИЦЕЛИВАНИЕ И СТРЕЛЬБА
    const hasTarget = checkLineOfSight(agentId);
    if (hasTarget) {
        reward += 0.005; // Видишь врага - хорошо
    }


    // 4. События
    if (room.bulletEvents) {
        room.bulletEvents.forEach(e => {
            if (e.ownerId === agentId) {
                if (e.type === 'PLAYER_FIRE') {
                    episodeStats.shots++;
                    // Штраф за выстрел (Ammo Penalty)
                    // Небольшой, чтобы не боялся стрелять, но не спамил
                    reward -= 0.1; 
                }
                else if (e.type === 'TANK_EXPLODE') {
                    // Убил бота
                    reward += 20.0;
                    episodeStats.kills++;
                    if (IS_LEADER) console.log(`[🔫] KILL! (${episodeStats.kills}/3)`);
                }
                else if (e.type === 'ARMOR_HIT') {
                    reward += 1.0;
                }
            }
        });
    }

    // 5. Смерть (врезался в бота или самоубился об стену рикошетом?)
    if (player.isDead) {
        reward -= 20.0; // Сильный штраф, нельзя умирать
    }

    // 6. ПОБЕДА: Все враги мертвы
    if (room.enemies.length === 0) {
        //reward += 100.0; // БОЛЬШОЙ БОНУС
        if (IS_LEADER) console.log(`[🏆] WAVE CLEARED! Steps: ${episodeStats.steps}`);
        return { reward, done: true }; // Принудительно завершаем эпизод
    }

    return { reward, done: false };
}

// --- TCP ---
const server = net.createServer((socket) => {
    socket.on('data', async (data) => {
        const lines = data.toString().trim().split('\n');
        for (const msg of lines) {
            if (!msg) continue;
            try {
                if (msg === 'RESET') {
                    // Загружаем карту (можно рандомную, можно 1.json)
                    await room.loadMap('ml_0'); 
                    room.resetGame();

                    const heroTeam = Math.random() < 0.5 ? 1 : 2;
                    const enemyTeam = (heroTeam === 1) ? 2 : 1;
                    room.settings.botsReserve = { 1: 0, 2: 0 }; 

                    // 1. Создаем Нашего Агента в случайном месте
                    room.addPlayer(AGENT_SOCKET_ID, 0, "AI_BOT");
                    const p = room.players[AGENT_ID];
                    if (p) {
                        p.team = heroTeam;
                        const pos = getRandomFreePosition();
                        p.x = pos.x; 
                        p.y = pos.y;
                        p.isSpawning = false;
                        p.spawnAnimTimer = 9999;
                        p.shieldTimer = 0; 
                    }

                    // 2. Спавним 3 манекена
                    room.enemies = []; // Очистка
                    for(let i=0; i<3; i++) spawnDummyBot(enemyTeam);

                    // Сброс статистики
                    episodeStats = { steps: 0, kills: 0, shots: 0, startPos: {x: p?.x, y: p?.y} };

                    const obs = room.getGameStateMatrix(AGENT_ID);
                    socket.write(JSON.stringify({
                        observation: Array.from(obs), reward: 0, done: false, info: {}
                    }) + "\n");
                    
                    tryBroadcast();
                } 
                else if (msg.startsWith('STEP')) {
                    const action = parseInt(msg.split(' ')[1]);
                    room.applyAction(AGENT_ID, action);

                    // ЗАМОРОЗКА ВРАГОВ (Каждый кадр, на всякий случай)
                    room.enemies.forEach(e => {
                        e.isMoving = false;
                        e.bulletTimer = 9999;
                    });

                    let totalReward = 0;
                    let isDone = false;
                    const FRAME_SKIP = 4;

                    for (let i = 0; i < FRAME_SKIP; i++) {
                        room.update();
                        
                        const res = calculateReward(AGENT_ID);
                        totalReward += res.reward;
                        
                        if (res.done) isDone = true; // Победа (все убиты)
                        if (room.players[AGENT_ID] && room.players[AGENT_ID].isDead) isDone = true; // Смерть
                        
                        if (isDone) break;
                    }
                    
                    episodeStats.steps++;
                    
                    // Тайм-лимит эпизода (чтобы не ездил вечно)
                    // 1000 шагов * 4 тика = 4000 тиков = ~66 секунд
                    if (episodeStats.steps > 1000) isDone = true;

                    tryBroadcast();

                    const obs = room.getGameStateMatrix(AGENT_ID);
                    socket.write(JSON.stringify({
                        observation: Array.from(obs), 
                        reward: totalReward, 
                        done: isDone, 
                        info: {}
                    }) + "\n");
                }
            } catch (e) { console.error(e); }
        }
    });
});

// --- СТАРТ ---
async function start() {
    await room.loadMap('1'); 
    room.resetGame();

    // Запускаем TCP (на порту из аргументов)
    server.listen(TCP_PORT, () => {
        // Логируем только лидера, чтобы не спамить 16 раз
        if (IS_LEADER) console.log(`ML Server (Leader) ready on port ${TCP_PORT}`);
    });

    // Запускаем HTTP (только Лидер)
    if (IS_LEADER && httpServer) {
        // Обработчик для зрителей
        io.on('connection', (socket) => {
            console.log('👀 Spectator connected');
            socket.on('join_room', () => {
                socket.join(`TRAIN_${TCP_PORT}`);
                socket.emit('room_joined', { roomId: `TRAIN_${TCP_PORT}`, isHost: false });
                socket.emit('map_init', room.map);
                socket.emit('game_start');
                
                // Шлем начальный стейт, чтобы не было пустого экрана
                socket.emit('state', {
                    players: room.players,
                    enemies: room.enemies,
                    bullets: room.bullets,
                    map: room.map,
                    pendingSpawns: room.pendingSpawns,
                    botsSpawnedCount: room.botsSpawnedCount || {1:0, 2:0},
                    teamWins: room.teamWins || {1:0, 2:0},
                    isGameOver: false,
                    settings: room.settings 
                });
            });
        });

        httpServer.listen(WEB_PORT, () => {
            console.log(`👀 Watch Mode: http://localhost:${WEB_PORT}/?room=TRAIN_${TCP_PORT}`);
        });
    }
}

start();