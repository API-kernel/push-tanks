import { createLevel, destroyBlockAt } from './shared/level.js';
import { updateBullets, createBullet } from './shared/bullet.js';
import { updateEnemies, hitEnemy } from './shared/enemy.js';
import { updateTankMovement } from './shared/tank.js';
import { TeamManager } from './shared/team_manager.js';
import { checkRectOverlap } from './shared/utils.js';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, SERVER_FPS, CHAT_HISTORY_LENGTH,
     SHIELD_DURATION, SPAWN_ANIMATION_DURATION, TEAMS_CONFIG, SPAWN_COLUMNS } from './shared/config.js';
import { spawnBonus, checkBonusCollection } from './shared/bonus.js';
import { HELMET_DURATION, SHOVEL_DURATION, CLOCK_DURATION, TANK_STATS, ENABLE_CHEATS } from './shared/config.js';
import { BattleSystem } from './battle_system.js';
import fs from 'fs/promises';

export class GameRoom {
    constructor(roomId, io = null, mapList = []) {
        this.id = roomId;
        this.io = io;
        this.mapList = mapList;

        // --- СОСТОЯНИЕ (STATE) ---
        this.players = {}; 
        this.map = null;
        this.enemies = [];
        this.bullets = [];
        this.pendingSpawns = [];
        this.activeBonus = null;
        this.bulletEvents = []; 
        this.chatHistory = [];

        this.teamManager = new TeamManager();
        this.teamSpawnTimers = {};
        this.enemyIdCounter = 1000;
        
        this.effectTimers = { shovels: { 1: 0, 2: 0 }, clock: 0, clockTeam: 0 };
        
        this.isPaused = false;
        this.isGameOver = false;
        this.winnerTeamId = null;
        this.gameOverTimer = 0;
        this.botsSpawnedCount = { 1: 0, 2: 0 };
        this.teamWins = { 1: 0, 2: 0 };
        this.isRunning = false;
        this.mapDirty = true;
        this.tickCount = 0;  

        this.settings = {
            level: 1,
            basesEnabled: true, 
            autoNextLevel: false,
            vibraniumBase: true,
            allowHotJoin: true,
            friendlyFire: false,
            startLives: 4,
            maxActiveTanks: 6,
            botsReserve: { 1: 20, 2: 20 } 
        };

        this.battleSystem = new BattleSystem(this);

        this.resetGame();

    }

    addPlayer(socketId, localIndex, nickname) {
        const uniqueId = `${socketId}_${localIndex}`;
        
        let pIndex = 0;
        while (Object.values(this.players).some(p => p.playerIndex === pIndex)) {
            pIndex++;
        }

        const limit = this.settings.maxActiveTanks;
        let teamId = 0; // По умолчанию 0 (если ничего не выйдет)


        let preferredTeam = null;

        // 1. Если это Локальный Игрок 2 (или 3...), ищем "Главного" (P1)
        if (localIndex > 0) {
            const p1Id = `${socketId}_0`; // ID первого игрока на этом сокете
            const p1 = this.players[p1Id];
            
            // Если P1 существует и играет (не зритель), хотим к нему
            if (p1 && p1.team > 0) {
                preferredTeam = p1.team;
            }
        }

        // 2. Пробуем попасть в любимую команду (Co-op)
        if (preferredTeam) {
            const count = this.getTeamPlayerCount(preferredTeam);
            if (count < limit) {
                teamId = preferredTeam;
            }
        }

        // 3. Если команда еще не выбрана (это P1, или у P1 нет места, или P1 зритель)
        // ИДЕМ ПО СТАНДАРТНОМУ БАЛАНСУ (PvP / Auto)
        if (teamId === 0) {
            const count1 = this.getTeamPlayerCount(1);
            const count2 = this.getTeamPlayerCount(2);
            
            const canJoin1 = count1 < limit;
            const canJoin2 = count2 < limit;

            if (canJoin1 && canJoin2) {
                // Если оба свободны - идем туда, где МЕНЬШЕ (баланс)
                if (count1 <= count2) teamId = 1;
                else teamId = 2;
            } else if (canJoin1) {
                teamId = 1;
            } else if (canJoin2) {
                teamId = 2;
            } else {
                teamId = 0; // Мест нет вообще -> Зритель
            }
        }

        const sp = (teamId > 0) ? this.getPlayerSpawnPoint(pIndex, teamId) : { x: -1000, y: -1000 };
        const teamConfig = this.teamManager.getTeam(teamId);
        
        this.players[uniqueId] = {
            id: uniqueId,
            nickname: nickname,
            socketId, localIndex, playerIndex: pIndex,
            team: teamId,
            x: sp.x, y: sp.y,
            speed: TANK_STATS.player.speed,
            direction: teamConfig ? teamConfig.direction : 'UP',
            isMoving: false, 
            hp: TANK_STATS.player.levels[1].hp, 
            lives: this.settings.startLives,
            level: 1,
            isDead: (teamId === 0), // Зритель сразу мертв
            respawnTimer: 0,
            isSpawning: (teamId > 0), // Зритель не спавнится
            spawnAnimTimer: 0,
            shieldTimer: SHIELD_DURATION,
            bulletCooldown: 0, 
            cheatCooldown: 0,
            inputs: { up: false, down: false, left: false, right: false, fire: false, cheat0: false }
        };
        
        const newPlayer = this.players[uniqueId];
        if (teamId > 0) {
            this.assignSpawnPosition(newPlayer);
            destroyBlockAt(this.map, newPlayer.x, newPlayer.y);
            this.mapDirty = true;
        } else {
            newPlayer.x = -1000;
        }
    }

    removeLocalPlayer(socketId, localIndex) {
        const uniqueId = `${socketId}_${localIndex}`;
        if (this.players[uniqueId]) {
            delete this.players[uniqueId];
        }
    }

    removePlayer(socketId) {
        for (const id in this.players) {
            if (id.startsWith(socketId)) delete this.players[id];
        }
    }

    getTeamPlayerCount(teamId) {
        return Object.values(this.players).filter(p => p.team === teamId).length;
    }

    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };

        // ПРОВЕРКА ЛИМИТОВ ПОСЛЕ ИЗМЕНЕНИЯ
        // Если хост уменьшил лимит, лишних кидаем в зрители
        TEAMS_CONFIG.forEach(t => {
            const teamPlayers = Object.values(this.players).filter(p => p.team === t.id);
            const limit = this.settings.maxActiveTanks;
            
            if (teamPlayers.length > limit) {
                // Сортируем: кто последним пришел (по индексу), того и кикаем
                teamPlayers.sort((a, b) => b.playerIndex - a.playerIndex);
                
                const toKick = teamPlayers.length - limit;
                for(let i=0; i < toKick; i++) {
                    const p = teamPlayers[i];
                    p.team = 0;
                    p.isDead = true;
                    p.lives = -1;
                    p.x = -1000;
                }
            }
        });
    }

    async startGame() {
        if (this.isRunning && !this.isGameOver) return
        
        this.isGameOver = false; 
        this.isLoadingNextLevel = false;
        
        // 1. Загрузка (ждем завершения)
        const lvlName = this.settings.level;
        await this.loadMap(lvlName);

        if (!this.map) {
            console.error("Map not loaded!");
            return;
        }

        // 2. Только теперь запускаем
        this.resetGame(); 
        this.isRunning = true;
        
        if (this.io) {
            if (this.interval) clearInterval(this.interval);
            this.interval = setInterval(() => this.update(), 1000 / SERVER_FPS);
            
            this.io.to(this.id).emit('game_start');
            this.io.to(this.id).emit('map_init', this.map);
        }
    }

    stopGame() {
        this.isRunning = false;
        if (this.io) {
            if (this.interval) clearInterval(this.interval);
            this.io.to(this.id).emit('game_end');
        }
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        this.broadcastState();
    }

    handleInput(socketId, data) {
        for (const localIndex in data) {
            const id = `${socketId}_${localIndex}`;
            if (this.players[id]) {
                this.players[id].inputs = data[localIndex];
            }
        }
    }

    stopGameAndReturnToLobby() {
        this.isRunning = false;
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
         
        if (this.io) {
            this.io.to(this.id).emit('return_to_lobby');
            this.io.to(this.id).emit('lobby_update', { players: this.players, settings: this.settings })   
        };
    }

    update() {
        if (this.isPaused) {
            this.broadcastState();
            return;
        }

        if (this.isGameOver) {

            this.gameOverTimer++;
            if (this.gameOverTimer > 5 * SERVER_FPS) {
                if (this.settings.autoNextLevel) {
                    this.goToNextLevel();
                } else {
                    this.stopGameAndReturnToLobby();
                }
            }

            if (this.io) {
                this.io.to(this.id).emit('state', {
                    players: this.players,
                    enemies: this.enemies,
                    pendingSpawns: this.pendingSpawns,
                    bullets: this.bullets,
                    events: [],
                    map: this.mapDirty ? this.map : null,
                    bases: this.teamManager.getAllBases(),
                    settings: this.settings, 
                    botsSpawnedCount: this.botsSpawnedCount,
                    teamWins: this.teamWins,
                    isGameOver: this.isGameOver,
                    winnerTeamId: this.winnerTeamId,
                    bonus: this.activeBonus
                });
            }

            return;
        }

        // Периодическая синхронизация (раз в 1 секунду)
        if (this.tickCount++ % SERVER_FPS === 0) {
            this.mapDirty = true;
        }

        // --- ЛОГИКА ПОБЕДЫ (Симметричная) ---
        const teams = this.teamManager.getTeams();
        
        // Список ID живых команд
        const aliveTeamIds = [];

        teams.forEach(team => {
            const teamId = team.id;
            
            // 1. Резерв
            const reserve = (this.settings.botsReserve[teamId] || 0) - (this.botsSpawnedCount[teamId] || 0);
            
            // 2. Активные боты
            const activeBots = this.enemies.filter(e => e.team === teamId).length + 
                               this.pendingSpawns.filter(s => s.team === teamId).length;
                               
            // 3. Активные игроки (у которых lives >= 0)
            const activePlayers = Object.values(this.players).filter(p => p.team === teamId && p.lives >= 0).length;

            // Если есть хоть кто-то или есть резерв -> команда жива
            if (reserve > 0 || activeBots > 0 || activePlayers > 0) {
                aliveTeamIds.push(teamId);
            }
        });

        if (aliveTeamIds.length <= 1) {
            const winnerId = aliveTeamIds.length == 1 ? aliveTeamIds[0] : null;
            this.handleVictory(winnerId);
            return;
        }

        this.bulletEvents = [];

        // 1. ИГРОКИ
        for (const id in this.players) {
            if (this.players[id].team !== 0) {
                this.updatePlayer(this.players[id]);
            }
        }

        // 2. ВРАГИ
        const playerCounts = {};
        this.teamManager.getTeams().forEach(t => playerCounts[t.id] = 0);
        Object.values(this.players).forEach(p => { if(!p.isDead) playerCounts[p.team]++; });
        
        if (this.effectTimers.clock > 0) this.effectTimers.clock--;
        updateEnemies(this);

        // 3. ПУЛИ
        const bEvents = updateBullets(this.bullets, this.map, MAP_WIDTH, MAP_HEIGHT, this.teamManager, this.settings.vibraniumBase);
        this.bulletEvents.push(...bEvents);
        if (bEvents.some(e => e.type === 'HIT')) {
            this.mapDirty = true;
        }

        // 4. КОЛЛИЗИИ
        this.battleSystem.update();

        // --- МИГАНИЕ СТЕН (Лопата заканчивается) ---
        TEAMS_CONFIG.forEach(team => {
            if (this.effectTimers.shovels[team.id] > 0) {
                this.effectTimers.shovels[team.id]--;
                const timer = this.effectTimers.shovels[team.id];
                
                // Интервал мигания (0.5 сек)
                const flashInterval = Math.floor(SERVER_FPS / 2); // 30 тиков

                // Мигаем последние 3 секунды
                if (timer < 3 * SERVER_FPS && timer > 0) {
                    
                    // Заходим сюда каждые 0.5 сек
                    if (timer % flashInterval === 0) {
                        
                        // ИСПРАВЛЕНИЕ МАТЕМАТИКИ:
                        // Делим текущее время на интервал, чтобы получить номер такта (1, 2, 3...)
                        // И берем остаток от деления на 2, чтобы получить 0 или 1.
                        
                        const phase = Math.floor(timer / flashInterval) % 2;
                        
                        const isSteel = (phase === 0);
                        this.teamManager.fortifyBase(team.id, isSteel, this.map);
                        this.mapDirty = true;
                    }
                }
                
                if (timer === 0) {
                    this.teamManager.fortifyBase(team.id, false, this.map);
                    this.mapDirty = true;
                }
            }
        });


        // 5. ОТПРАВКА
        this.broadcastState();
        this.mapDirty = false;
    }

    updatePlayer(p) {
        if (p.isDead) {
            p.respawnTimer--;
            if (p.respawnTimer <= 0 && p.lives >= 0) {
                p.isDead = false;
                p.isSpawning = true;
                p.spawnAnimTimer = 0;
                p.level = 1;
                p.hp = TANK_STATS.player.levels[1].hp;
                
                this.assignSpawnPosition(p);
                const teamConfig = this.teamManager.getTeam(p.team);
                p.direction = teamConfig ? teamConfig.direction : 'UP';
                
                destroyBlockAt(this.map, p.x, p.y);
            }
            return;
        }

        if (ENABLE_CHEATS) {
            if (p.cheatCooldown > 0) p.cheatCooldown--;
            if (p.inputs.cheat0 && p.cheatCooldown <= 0) {
                const bases = this.teamManager.getAllBases();
                this.activeBonus = spawnBonus(this.map, bases, p.x, p.y - 32); 
                if(this.activeBonus) this.bulletEvents.push({type: 'BONUS_SPAWN'});
                p.cheatCooldown = SERVER_FPS / 2;
            }
        }

        if (p.isSpawning) {
            p.spawnAnimTimer++;
            if (p.spawnAnimTimer > SPAWN_ANIMATION_DURATION) { 
                p.isSpawning = false;
                p.shieldTimer = SHIELD_DURATION; 
            }
            return; 
        }

        const bonusType = checkBonusCollection(p, this.activeBonus);
        if (bonusType) {
            this.activeBonus = null; 
            this.applyBonus(p, bonusType);
        }

        if (p.shieldTimer > 0) p.shieldTimer--;
        
        const input = p.inputs;
        let direction = null;
        if (input.up) direction = 'UP';
        else if (input.down) direction = 'DOWN';
        else if (input.left) direction = 'LEFT';
        else if (input.right) direction = 'RIGHT';

        updateTankMovement(p, direction, MAP_WIDTH, MAP_HEIGHT, this.map, this.checkGlobalCollision.bind(this));

        const stats = TANK_STATS.player.levels[p.level || 1];
        if (p.bulletCooldown > 0) p.bulletCooldown--;
        if (input.fire) {
            const myBullets = this.bullets.filter(b => b.ownerId === p.id && !b.isDead).length;
            const maxBullets = (p.level >= 3) ? 2 : 1; 
            if (p.bulletCooldown === 0 && myBullets < maxBullets) {
                const bullet = createBullet(p, stats.bulletSpeed);
                this.bullets.push(bullet);
                this.bulletEvents.push({ type: 'PLAYER_FIRE', ownerId: p.id });
                p.bulletCooldown = stats.cooldown;
            }
        }
    }

    applyBonus(player, type) {
        this.bulletEvents.push({ type: 'BONUS_TAKEN' });
        this.sendSystemMessage(`${player.nickname || 'Player'} picked up ${type.toUpperCase()}`);

        switch(type) {
            case 'helmet': player.shieldTimer = HELMET_DURATION; break;
            case 'clock': 
                this.effectTimers.clock = CLOCK_DURATION; 
                this.effectTimers.clockTeam = player.team; 
                break;
            case 'shovel': 
                // Ставим таймер конкретно для этой команды
                this.effectTimers.shovels[player.team] = SHOVEL_DURATION;
                
                // Сразу строим бетон
                this.teamManager.fortifyBase(player.team, true, this.map); 
                this.mapDirty = true; 
                break;
            case 'star': 
                player.level++; 
                if(player.level>4) 
                    player.level=4; 
                    player.hp = TANK_STATS.player.levels[player.level].hp; // Максимум
                break;
            case 'gun': 
                player.level = 4;
                player.hp = TANK_STATS.player.levels[player.level].hp;
                break;
            case 'grenade':
                this.bulletEvents.push({ type: 'GRENADE_EXPLODE' });
                for(let i = this.enemies.length-1; i>=0; i--) {
                    if(this.enemies[i].team !== player.team) {
                        this.enemies[i].hp=0;
                        hitEnemy(this, i); 
                    }
                }
                break;
            case 'tank': player.lives++; this.bulletEvents.push({ type: 'LIFE_UP' }); break;
        }
    }

    checkGlobalCollision(targetX, targetY, currX, currY, excludeId) {
        const targetRect = { x: targetX + 2, y: targetY + 2, width: 12, height: 12 };
        const currentRect = { x: currX + 2, y: currY + 2, width: 12, height: 12 };

        const check = (entity) => {
            if (entity.id === excludeId) return false;
            if (entity.isSpawning || entity.isDead) return false;
            if (checkRectOverlap(targetRect, entity)) {
                if (checkRectOverlap(currentRect, entity)) return false; 
                return true; 
            }
            return false;
        };

        for (const id in this.players) if (check(this.players[id])) return true;
        for (const e of this.enemies) if (check(e)) return true;
        
        const bases = this.teamManager.getAllBases();
        for (const base of bases) if (checkRectOverlap(targetRect, base)) return true;

        return false;
    }

    getPlayerSpawnPoint(teamRank, teamId) {
        const col = SPAWN_COLUMNS[teamRank % SPAWN_COLUMNS.length];
        
        const team = this.teamManager.getTeam(teamId);
        const y = team ? team.spawnPixelY : 0;
        
        return { x: col * TILE_SIZE, y };
    }

    assignSpawnPosition(player) {
        if (player.team === 0) return;
        
        // 1. Ищем всех сокомандников
        const teammates = Object.values(this.players)
            .filter(p => p.team === player.team)
            // Сортируем по времени входа (playerIndex), чтобы порядок был стабильным
            .sort((a, b) => a.playerIndex - b.playerIndex);
            
        // 2. Узнаем, какой я по счету (0, 1, 2...)
        const myRank = teammates.indexOf(player);
        
        // 3. Получаем координаты
        const sp = this.getPlayerSpawnPoint(myRank, player.team);
        
        player.x = sp.x;
        player.y = sp.y;
    }

    handleVictory(winnerTeamId) {
        if (this.isGameOver) return;

        this.isGameOver = true;
        this.winnerTeamId = winnerTeamId;
        this.gameOverTimer = 0;
        
        if (winnerTeamId) this.teamWins[winnerTeamId]++;

        const team = this.teamManager.getTeam(winnerTeamId);
        this.sendSystemMessage(`${team.name} TEAM WINS!`);
        console.log(`GAME OVER in room ${this.id}. Winner: Team ${winnerTeamId}`);
    }

    goToNextLevel() {
        let nextLevel = this.settings.level;

        if (this.mapList.length > 0) {
            let nextIdx = Math.floor(Math.random() * this.mapList.length);
            
            if (this.mapList.length > 1) {
                const currentStr = String(this.settings.level);
                
                if (this.mapList[nextIdx] === currentStr) {
                    nextIdx = (nextIdx + 1) % this.mapList.length;
                }
            }

            nextLevel = this.mapList[nextIdx];
            this.settings.level = nextLevel;    
        }

        if (this.io) {
            this.io.to(this.id).emit('lobby_update', { settings: this.settings, players: this.players });
        }

        this.startGame();
    }

    resetGame() {        
        this.bullets = [];
        this.enemies = [];
        this.pendingSpawns = [];
        this.activeBonus = null;
        this.winnerTeamId = null;
        this.isGameOver = false;
        this.gameOverTimer = 0;
        this.effectTimers = { shovels: { 1: 0, 2: 0 }, clock: 0, clockTeam: 0 };
        this.botsSpawnedCount = { 1: 0, 2: 0 };

        this.teamManager = new TeamManager();
        this.teamManager.setBasesEnabled(this.settings.basesEnabled);
        this.map = createLevel(this.rawMapData, this.settings.basesEnabled);
        this.mapDirty = true;

        for (const id in this.players) {
            const p = this.players[id];

            if (p.team === 0) {
                p.isDead = true;
                p.lives = -1;
                p.x = -1000;
                continue;
            }

            p.isDead = false;
            p.isSpawning = true;
            p.spawnAnimTimer = 0;
            p.lives = this.settings.startLives
            p.level = 1;
            
            this.assignSpawnPosition(p); 

            const teamConfig = this.teamManager.getTeam(p.team);
            p.direction = teamConfig ? teamConfig.direction : 'UP';

            destroyBlockAt(this.map, p.x, p.y);
        }
    }

    broadcastState() {
        if (!this.io) return;

        this.io.to(this.id).emit('state', {
            players: this.players,
            enemies: this.enemies,
            pendingSpawns: this.pendingSpawns,
            bullets: this.bullets,
            events: this.bulletEvents,
            map: this.mapDirty ? this.map : null,
            bases: this.teamManager.getAllBases(),
            isPaused: this.isPaused,
            settings: this.settings, 
            botsSpawnedCount: this.botsSpawnedCount,
            teamWins: this.teamWins,
            isGameOver: this.isGameOver,
            winnerTeamId: this.winnerTeamId,
            bonus: this.activeBonus,
            settings: this.settings
        });
    }

    destroy() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }

    handleChat(socketId, text) {
        // Ищем имя игрока (первого попавшегося на этом сокете, или P1)
        const pId = Object.keys(this.players).find(id => this.players[id].socketId === socketId);
        const player = this.players[pId];
        
        const name = player ? (player.nickname || "Player") : "Spectator";
        const team = player ? player.team : 0;

        const msg = {
            type: 'player',
            sender: name,
            team: team,
            text: text.substring(0, 50)
        };
        
        this.pushMessage(msg);
    }

    sendSystemMessage(text) {
        this.pushMessage({ type: 'system', text });
    }

    pushMessage(msg) {
        this.chatHistory.push(msg);
        if (this.chatHistory.length > CHAT_HISTORY_LENGTH) this.chatHistory.shift();
        
        // Шлем всем
        if (this.io) {
            this.io.to(this.id).emit('chat_update', msg);
        }
    }

    async loadMap(levelName) {
        try {
            // Читаем JSON файл
            const filePath = `./shared/maps/${levelName}.json`;
            const data = await fs.readFile(filePath, 'utf-8');
            this.rawMapData = JSON.parse(data);
            
            this.map = createLevel(this.rawMapData, this.settings.basesEnabled);
            console.log(`Map ${levelName} loaded`);
        } catch (e) {
            console.error(`Failed to load map ${levelName}`, e);
            this.rawMapData = Array(26).fill().map(() => Array(26).fill(0));
            this.map = createLevel(this.rawMapData, this.settings.basesEnabled);
        }
    }

    applyAction(playerId, action) {
        const player = this.players[playerId];
        if (!player) return;

        // Сбрасываем инпуты
        const inputs = { up: false, down: false, left: false, right: false, fire: false, cheat0: false };

        if (action === 1) inputs.up = true;
        if (action === 2) inputs.down = true;
        if (action === 3) inputs.left = true;
        if (action === 4) inputs.right = true;
        if (action === 5) inputs.fire = true;

        player.inputs = inputs;
    }

/**
     * Формирует "Зрение" для нейросети.
     * Формат: 6 каналов x 26 строк x 26 колонок
     */
    getGameStateMatrix(agentId) {
        const ROWS = 26;
        const COLS = 26;
        const CHANNELS = 6; // Было 5, стало 6
        
        const buffer = new Float32Array(CHANNELS * ROWS * COLS); 

        // Хелпер для записи
        const set = (ch, r, c, val) => {
            if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
                const index = (ch * ROWS * COLS) + (r * COLS) + c;
                buffer[index] = val;
            }
        };

        // --- КАНАЛ 0: КАРТА ---
        if (this.map) {
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    const block = this.map[r][c];
                    if (block) {
                        if (block.type === 1) set(0, r, c, 0.5); // Кирпич
                        if (block.type === 2) set(0, r, c, 1.0); // Бетон
                        if (block.type === 4) set(0, r, c, -0.5); // Вода
                    }
                }
            }
        }

        // Хелпер координат
        const toGrid = (val) => Math.floor((val + 8) / TILE_SIZE); 

        // --- СУЩНОСТИ ---
        const me = this.players[agentId];
        
        // Все танки (игроки + боты)
        const allTanks = [...Object.values(this.players), ...this.enemies];

        allTanks.forEach(tank => {
            if (tank.isDead) return;
            const r = toGrid(tank.y);
            const c = toGrid(tank.x);

            if (tank.id === agentId) {
                // КАНАЛ 1: ЭТО Я
                set(1, r, c, 1.0); 
            } else if (me) {
                if (tank.team !== me.team) {
                    // КАНАЛ 2: ВРАГИ
                    set(2, r, c, 1.0);
                } else {
                    // КАНАЛ 5: СОЮЗНИКИ (Teammates)
                    // Это танк моей команды, но не я сам
                    set(5, r, c, 1.0);
                }
            }
        });

        // --- КАНАЛ 3: ПУЛИ ---
        this.bullets.forEach(b => {
            if (b.isDead) return;
            const r = toGrid(b.y);
            const c = toGrid(b.x);
            
            if (me && b.team !== me.team) {
                set(3, r, c, 1.0); // Опасная пуля
            } else {
                set(3, r, c, -0.5); // Своя/Союзная пуля (информативно)
            }
        });

        // --- КАНАЛ 4: БАЗА ---
        const bases = this.teamManager.getAllBases();
        bases.forEach(base => {
            if (base.isDead) return;
            const r = Math.floor(base.y / TILE_SIZE);
            const c = Math.floor(base.x / TILE_SIZE);
            
            if (me) {
                if (base.team === me.team) {
                    // КАНАЛ 4: НАША БАЗА (Defend)
                    set(4, r, c, 1.0);
                    set(4, r+1, c, 1.0);
                    set(4, r, c+1, 1.0);
                    set(4, r+1, c+1, 1.0);
                } else {
                    // КАНАЛ 6: ВРАЖЕСКАЯ БАЗА (Attack)
                    set(6, r, c, 1.0);
                    set(6, r+1, c, 1.0);
                    set(6, r, c+1, 1.0);
                    set(6, r+1, c+1, 1.0);
                }
            }
        });

        return buffer;
    }
}