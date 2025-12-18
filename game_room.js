import { createLevel, destroyBlockAt } from './shared/level.js';
import { updateBullets, createBullet } from './shared/bullet.js';
import { updateEnemies, hitEnemy } from './shared/enemy.js';
import { updateTankMovement } from './shared/tank.js';
import { TeamManager } from './shared/team_manager.js';
import { checkRectOverlap } from './shared/utils.js';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, SERVER_FPS, CHAT_HISTORY_LENGTH, SHIELD_DURATION, SPAWN_ANIMATION_DURATION } from './shared/config.js';
import { spawnBonus, checkBonusCollection } from './shared/bonus.js';
import { HELMET_DURATION, SHOVEL_DURATION, CLOCK_DURATION, TANK_STATS, ENABLE_CHEATS } from './shared/config.js';
import { BattleSystem } from './battle_system.js';
import fs from 'fs/promises';

export class GameRoom {
    constructor(roomId, io, mapList = []) {
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
        
        this.effectTimers = { shovel: 0, shovelTeam: 0, clock: 0, clockTeam: 0 };
        
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
            allowHotJoin: true,
            friendlyFire: false,
            startLives: 2,
            maxActiveEnemies: 4,
            botsReserve: { 1: 20, 2: 20 } 
        };

        this.battleSystem = new BattleSystem(this);

        this.resetGame();

    }

    addPlayer(socketId, localIndex, nickname) {
        const uniqueId = `${socketId}_${localIndex}`;
        
        let pIndex = 0;
        while (true) {
            const occupied = Object.values(this.players).some(p => p.playerIndex === pIndex);
            if (!occupied) break;
            pIndex++;
        }

        const teamId = 1; 
        const sp = this.getPlayerSpawnPoint(pIndex, teamId);
        const teamConfig = this.teamManager.getTeam(teamId);
        
        this.players[uniqueId] = {
            id: uniqueId,
            nickname: nickname,
            socketId, localIndex, playerIndex: pIndex,
            team: teamId,
            x: sp.x, y: sp.y,
            speed: TANK_STATS.player.speed,
            direction: teamConfig ? teamConfig.direction : 'UP',
            isMoving: false, hp: 1, 
            lives: this.settings.startLives, 
            frameIndex: 0,
            frameTimer: 0,
            level: 1,
            isDead: false, 
            respawnTimer: 0,
            isSpawning: true, 
            spawnAnimTimer: 0,
            shieldTimer: SHIELD_DURATION,
            bulletCooldown: 0, 
            cheatCooldown: 0,
            inputs: { up: false, down: false, left: false, right: false, fire: false, cheat0: false }
        };
        
        destroyBlockAt(this.map, this.players[uniqueId].x, this.players[uniqueId].y);
        this.mapDirty = true;
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

    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
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
        
        // Очищаем старый интервал на всякий случай
        if (this.interval) clearInterval(this.interval);
        
        this.interval = setInterval(() => this.update(), 1000 / SERVER_FPS);
        
        this.io.to(this.id).emit('game_start');
        this.io.to(this.id).emit('map_init', this.map);
    }

    stopGame() {
        this.isRunning = false;
        if (this.interval) clearInterval(this.interval);
        this.io.to(this.id).emit('game_end');
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
        
        this.io.to(this.id).emit('return_to_lobby');
        this.io.to(this.id).emit('lobby_update', { players: this.players, settings: this.settings });
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
            this.updatePlayer(this.players[id]);
        }

        // 2. ВРАГИ
        const playerCounts = {};
        this.teamManager.getTeams().forEach(t => playerCounts[t.id] = 0);
        Object.values(this.players).forEach(p => { if(!p.isDead) playerCounts[p.team]++; });
        
        if (this.effectTimers.clock > 0) this.effectTimers.clock--;
        updateEnemies(this);

        // 3. ПУЛИ
        const bEvents = updateBullets(this.bullets, this.map, MAP_WIDTH, MAP_HEIGHT, this.teamManager);
        this.bulletEvents.push(...bEvents);
        if (bEvents.some(e => e.type === 'HIT')) {
            this.mapDirty = true;
        }

        // 4. КОЛЛИЗИИ
        this.battleSystem.update();

        // --- МИГАНИЕ СТЕН (Лопата заканчивается) ---
        if (this.effectTimers.shovel > 0) {
            this.effectTimers.shovel--;
            
            if (this.effectTimers.shovel < 3 * SERVER_FPS) {
                // Мигаем каждые 30 кадров (0.5 сек)
                if (this.effectTimers.shovel % (SERVER_FPS / 2) === 0) {
                    const phase = Math.floor(this.effectTimers.shovel / (SERVER_FPS / 2)) % 2;
                    const isSteel = (phase === 0);
                    this.teamManager.fortifyBase(this.effectTimers.shovelTeam, isSteel, this.map);
                    this.mapDirty = true;
                }
            }
            
            if (this.effectTimers.shovel === 0) {
                this.teamManager.fortifyBase(this.effectTimers.shovelTeam, false, this.map);
                this.mapDirty = true;
            }
        }


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
                
                const sp = this.getPlayerSpawnPoint(p.playerIndex, p.team);
                p.x = sp.x;
                p.y = sp.y;
                
                const teamConfig = this.teamManager.getTeam(p.team);
                p.direction = teamConfig ? teamConfig.direction : 'UP';
                
                destroyBlockAt(this.map, p.x, p.y);
            }
            return;
        }

        if (ENABLE_CHEATS) {
            if (p.cheatCooldown > 0) p.cheatCooldown--;
            if (p.inputs.cheat0 && p.cheatCooldown <= 0) {
                this.activeBonus = spawnBonus(p.x, p.y - 32); 
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
                
                // if (p.level == 1) {
                //     p.bulletCooldown = Math.round(SERVER_FPS / 2);
                // } else if (p.level <= 3) {
                //     p.bulletCooldown = Math.round(SERVER_FPS / 3);
                // } else {
                //     p.bulletCooldown = Math.round(SERVER_FPS / 5);
                // }
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
                this.effectTimers.shovel = SHOVEL_DURATION; 
                this.effectTimers.shovelTeam = player.team; 
                this.teamManager.fortifyBase(player.team, true, this.map); 
                this.mapDirty = true; 
                break;
            case 'star': 
                player.level++; 
                if(player.level>4) player.level=4; 
                break;
            case 'gun': player.level = 4; break;
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

    getPlayerSpawnPoint(pIndex, teamId) {
        const priority = [8, 16, 0, 24];
        const col = priority[pIndex % priority.length];
        const team = this.teamManager.getTeam(teamId);
        const y = team ? team.spawnPixelY : 0;
        return { x: col * TILE_SIZE, y };
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
        const currentStr = String(this.settings.level);
        let nextLevel = this.settings.level;
        
        const idx = this.mapList.indexOf(currentStr);
        if (idx !== -1) {
            const nextIdx = (idx + 1) % this.mapList.length;
            nextLevel = this.mapList[nextIdx];
        } else if (this.mapList.length > 0) {
            nextLevel = this.mapList[0];
        } else {
             const num = parseInt(this.settings.level);
             if (!isNaN(num)) nextLevel = num + 1;
        }

        this.settings.level = nextLevel;
        
        this.io.to(this.id).emit('lobby_update', { settings: this.settings, players: this.players });

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
        this.effectTimers = { shovel: 0, shovelTeam: 0, clock: 0, clockTeam: 0 };
        this.botsSpawnedCount = { 1: 0, 2: 0 };

        this.teamManager = new TeamManager();
        this.teamManager.setBasesEnabled(this.settings.basesEnabled);
        this.map = createLevel(this.rawMapData, this.settings.basesEnabled);
        this.mapDirty = true;

        for (const id in this.players) {
            const p = this.players[id];
            p.isDead = false;
            p.isSpawning = true;
            p.spawnAnimTimer = 0;
            p.lives = this.settings.startLives
            p.level = 1;
            const sp = this.getPlayerSpawnPoint(p.playerIndex, p.team);
            p.x = sp.x; p.y = sp.y;
            
            const teamConfig = this.teamManager.getTeam(p.team);
            p.direction = teamConfig ? teamConfig.direction : 'UP';

            destroyBlockAt(this.map, p.x, p.y);
        }
    }

    broadcastState() {
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
        this.io.to(this.id).emit('chat_update', msg);
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
}