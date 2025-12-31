import net from 'net';
import { GameRoom } from './game_room.js';

const PORT = 4000;
const AGENT_SOCKET_ID = "AI_AGENT";
const AGENT_ID = `${AGENT_SOCKET_ID}_0`; // ID внутри комнаты будет таким

// Создаем комнату без IO
const room = new GameRoom("TRAIN_ROOM", null);

// Настройки для тренировки (упрощаем жизнь боту для начала)
room.settings.maxActiveTanks = 2; // 1 на 1 (или 1 против ботов)
room.settings.startLives = 0; // Смерть = конец эпизода (для быстрого обучения)

// Хелпер для расчета награды
function calculateReward(agentId) {
    let reward = 0.0;
    const player = room.players[agentId];

    if (!player) return 0; // Игрок еще не создан или умер

    // 1. Награда за выживание (маленькая, чтобы не стоял на месте вечно)
    reward += 0.01;

    // 2. Анализ событий этого кадра
    // room.bulletEvents содержит события, произошедшие за последний update()
    if (room.bulletEvents && room.bulletEvents.length > 0) {
        room.bulletEvents.forEach(e => {
            // Если событие инициировал НАШ бот
            if (e.ownerId === agentId) {
                if (e.type === 'TANK_EXPLODE') {
                    if (e.isPlayer) {
                        reward += 50.0; // Убил игрока (очень хорошо)
                    } else {
                        reward += 10.0; // Убил бота
                    }
                } else if (e.type === 'HIT') {
                    reward += 0.5; // Просто попал (поощряем стрельбу)
                } else if (e.type === 'BASE_DESTROY') {
                    reward -= 50.0; // Уничтожил свою базу (плохо!)
                }
            }
            
            // Если событие случилось С НАШИМ ботом (независимо от того, чья пуля)
            // (Но координаты события должны быть рядом с танком? Нет, логика проще)
            // Танк умирает в battle_system, мы узнаем об этом через состояние player.isDead
        });
    }

    // 3. Наказание за смерть
    if (player.isDead) {
        reward -= 10.0;
    }

    // 4. Наказание за Game Over (поражение)
    if (room.isGameOver && room.winnerTeamId !== player.team) {
        reward -= 50.0;
    }
    
    // 5. Награда за Победу
    if (room.isGameOver && room.winnerTeamId === player.team) {
        reward += 50.0;
    }

    return reward;
}

// TCP Сервер
const server = net.createServer((socket) => {
    console.log('Python client connected');

    socket.on('data', (data) => {
        const msg = data.toString().trim();
        
        try {
            // Протокол: "CMD ARG"
            // CMD: RESET, STEP
            
            if (msg === 'RESET') {
                // 1. Сброс игры
                room.resetGame();
                // 2. Добавляем нашего агента
                room.addPlayer(AGENT_SOCKET_ID, 0, "RoboCop");
                // 3. Получаем первое состояние
                const obs = room.getGameStateMatrix(AGENT_ID);
                
                // Отправляем ответ
                const response = JSON.stringify({
                    observation: Array.from(obs), // Конвертируем TypedArray в массив
                    reward: 0,
                    done: false,
                    info: {}
                });
                socket.write(response + "\n"); // \n важно для Python readline
            } 
            else if (msg.startsWith('STEP')) {
                // Формат: "STEP 3" (где 3 - это действие)
                const action = parseInt(msg.split(' ')[1]);

                // 1. Применяем действие
                room.applyAction(AGENT_ID, action);

                // 2. Шаг физики (тик)
                // Можно делать несколько тиков, чтобы ускорить игру для нейросети
                // Например, 4 тика на 1 решение (Frame Skipping)
                const FRAME_SKIP = 4;
                let totalReward = 0;
                let done = false;

                for (let i = 0; i < FRAME_SKIP; i++) {
                    if (room.isGameOver) {
                        done = true;
                        break;
                    }
                    room.update();
                    totalReward += calculateReward(AGENT_ID);
                    
                    // Если умер в процессе фрейм-скипа
                    if (room.players[AGENT_ID] && room.players[AGENT_ID].isDead) {
                        done = true; 
                        // Не брейкаем сразу, даем докрутить логику респавна если надо, 
                        // но для обучения обычно смерть = конец эпизода.
                        break;
                    }
                }

                // 3. Собираем состояние
                const obs = room.getGameStateMatrix(AGENT_ID);
                
                const response = JSON.stringify({
                    observation: Array.from(obs),
                    reward: totalReward,
                    done: done || room.isGameOver,
                    info: {}
                });
                socket.write(response + "\n");
            }

        } catch (e) {
            console.error("Error processing command:", e);
            socket.write(JSON.stringify({ error: e.message }) + "\n");
        }
    });

    socket.on('end', () => {
        console.log('Python client disconnected');
    });
});

server.listen(PORT, () => {
    console.log(`ML Server listening on port ${PORT}`);
});