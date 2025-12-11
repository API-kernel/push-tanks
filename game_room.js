import { createLevel, destroyBlockAt } from './shared/level.js';
import { updateBullets, createBullet } from './shared/bullet.js';
import { updateEnemies, hitEnemy } from './shared/enemy.js';
import { updateTankMovement } from './shared/tank.js';
import { TeamManager } from './shared/team_manager.js';
import { checkRectOverlap } from './shared/utils.js';
import { MAP_WIDTH, MAP_HEIGHT, TANK_STATS, TILE_SIZE } from './shared/config.js';
import { spawnBonus, getActiveBonus, checkBonusCollection, clearBonus } from './shared/bonus.js';
import { HELMET_DURATION, SHOVEL_DURATION, CLOCK_DURATION } from './shared/config.js';

export class GameRoom {
    constructor(roomId, io) {
        this.id = roomId;
        this.io = io;
        
        // --- СОСТОЯНИЕ (STATE) ---
        this.players = {}; 
        this.map = createLevel();
        this.enemies = [];
        this.bullets = [];
        this.pendingSpawns = [];
        this.activeBonus = null;
        this.bulletEvents = []; 
        
        this.teamManager = new TeamManager();
        this.teamSpawnTimers = {};
        this.enemyIdCounter = 2000;
        
        this.effectTimers = { shovel: 0, shovelTeam: 0, clock: 0, clockTeam: 0 };
        
        this.isGameOver = false;
        this.gameOverTimer = 0;

        this.resetGame();

        this.isRunning = false;

        this.settings = {
            level: 1,
            botsEnabled: true,
            allowHotJoin: true,
            friendlyFire: false // Задел на будущее
        };
    }

    addPlayer(socketId, localIndex) {
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
            socketId, localIndex, playerIndex: pIndex,
            team: teamId,
            x: sp.x, y: sp.y,
            speed: TANK_STATS.player.speed,
            direction: teamConfig ? teamConfig.direction : 'UP',
            isMoving: false, hp: 1, lives: 3, level: 1,
            isDead: false, respawnTimer: 0,
            isSpawning: true, spawnAnimTimer: 0,
            shieldTimer: 180,
            bulletCooldown: 0, cheatCooldown: 0,
            inputs: { up: false, down: false, left: false, right: false, fire: false, cheat0: false }
        };
        
        destroyBlockAt(this.map, this.players[uniqueId].x, this.players[uniqueId].y);
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

    startGame() {
        if (this.isRunning) return;
        
        if (this.interval) clearInterval(this.interval);

        this.resetGame(); // Сброс карты и позиций
        this.isRunning = true;
        
        // Запускаем цикл
        this.interval = setInterval(() => this.update(), 1000 / 60);
        
        // Сообщаем всем, что игра началась (переход из лобби в канвас)
        this.io.to(this.id).emit('game_start');
        
        // Отправляем начальную карту (важно!)
        this.io.to(this.id).emit('map_init', this.map);
    }

    stopGame() {
        this.isRunning = false;
        if (this.interval) clearInterval(this.interval);
        // Можно выкинуть игроков обратно в лобби событием 'game_end'
    }

    handleInput(socketId, data) {
        for (const localIndex in data) {
            const id = `${socketId}_${localIndex}`;
            if (this.players[id]) {
                this.players[id].inputs = data[localIndex];
            }
        }
    }

    update() {
        if (this.isGameOver) {
            this.gameOverTimer++;
            if (this.gameOverTimer > 300) {
                this.resetGame();
                this.io.to(this.id).emit('game_restart'); // Можно добавить это событие
            }

            this.io.to(this.id).emit('state', {
                players: this.players,
                enemies: this.enemies,
                bullets: this.bullets,
                events: [],
                map: this.map,
                bases: this.teamManager.getAllBases(),
                isGameOver: this.isGameOver,
                bonus: this.activeBonus
            });

            return;
        }

        this.bulletEvents = [];

        if (this.effectTimers.clock > 0) this.effectTimers.clock--;
        if (this.effectTimers.shovel > 0) {
            this.effectTimers.shovel--;
            if (this.effectTimers.shovel === 0) {
                this.teamManager.fortifyBase(this.effectTimers.shovelTeam, false, this.map);
            }
        }

        // 1. ИГРОКИ
        for (const id in this.players) {
            this.updatePlayer(this.players[id]);
        }

        // 2. ВРАГИ
        const playerCounts = {};
        this.teamManager.getTeams().forEach(t => playerCounts[t.id] = 0);
        Object.values(this.players).forEach(p => { if(!p.isDead) playerCounts[p.team]++; });
        
        // ВАЖНО: Мы больше не собираем allEntities тут, так как updateEnemies сам собирает 
        // busyEntities внутри из room.players и room.enemies.
        // Но нам нужно передать clockActiveTeam
        const clockActiveTeam = (this.effectTimers.clock > 0) ? this.effectTimers.clockTeam : null;
        
        updateEnemies(this, MAP_WIDTH, MAP_HEIGHT, this.checkGlobalCollision.bind(this), playerCounts, clockActiveTeam);

        // 3. ПУЛИ
        const bEvents = updateBullets(this.bullets, this.map, MAP_WIDTH, MAP_HEIGHT);
        this.bulletEvents.push(...bEvents);

        // 4. КОЛЛИЗИИ
        this.checkCollisions();

        // 5. ОТПРАВКА
        this.broadcastState();
    }

    updatePlayer(p) {
        if (p.isDead) {
            p.respawnTimer--;
            if (p.respawnTimer <= 0 && p.lives >= 0) {
                p.isDead = false; p.isSpawning = true; p.spawnAnimTimer = 0; p.level = 1;
                
                const sp = this.getPlayerSpawnPoint(p.playerIndex, p.team);
                p.x = sp.x;
                p.y = sp.y;
                
                const teamConfig = this.teamManager.getTeam(p.team);
                p.direction = teamConfig ? teamConfig.direction : 'UP';
                
                destroyBlockAt(this.map, p.x, p.y);
            }
            return;
        }

        if (p.cheatCooldown > 0) p.cheatCooldown--;
        if (p.inputs.cheat0 && p.cheatCooldown <= 0) {
            this.activeBonus = spawnBonus(p.x, p.y - 32); 
            if(this.activeBonus) this.bulletEvents.push({type: 'BONUS_SPAWN'});
            p.cheatCooldown = 30;
        }

        if (p.isSpawning) {
            p.spawnAnimTimer++;
            if (p.spawnAnimTimer > 60) { p.isSpawning = false; p.shieldTimer = 180; }
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

        if (direction) {
            updateTankMovement(p, direction, MAP_WIDTH, MAP_HEIGHT, this.map, this.checkGlobalCollision.bind(this));
        } else {
            p.isMoving = false;
        }

        if (p.bulletCooldown > 0) p.bulletCooldown--;
        if (input.fire) {
            const myBullets = this.bullets.filter(b => b.ownerId === p.id && !b.isDead).length;
            const maxBullets = (p.level >= 3) ? 2 : 1; 
            if (p.bulletCooldown === 0 && myBullets < maxBullets) {
                createBullet(p, this.bullets, this.map);
                this.bulletEvents.push({ type: 'PLAYER_FIRE', ownerId: p.id });
                p.bulletCooldown = (p.level >= 2) ? 15 : 25; 
            }
        }
    }

    checkCollisions() {
        const targets = [...this.enemies, ...Object.values(this.players).filter(p => !p.isDead && !p.isSpawning)];

        this.bullets.forEach(b => {
            if (b.isDead) return;

            for (const otherB of this.bullets) {
                if (b !== otherB && !otherB.isDead && b.team !== otherB.team) {
                    if (checkRectOverlap(b, otherB)) {
                        b.isDead = true; otherB.isDead = true;
                        this.bulletEvents.push({ type: 'BULLET_CLASH', x: b.x, y: b.y });
                    }
                }
            }
            if (b.isDead) return;

            const bases = this.teamManager.getAllBases();
            bases.forEach(base => {
                if (base.isDead) return;
                if (checkRectOverlap(b, base)) {
                    b.isDead = true;
                    this.teamManager.destroyBase(base.team);
                    this.bulletEvents.push({ type: 'BASE_DESTROY', x: base.x, y: base.y });
                    this.isGameOver = true;
                }
            });

            for (const tank of targets) {
                if (b.team !== tank.team) {
                    if (checkRectOverlap(b, tank)) {
                        b.isDead = true;
                        
                        if (tank.shieldTimer > 0) {
                            this.bulletEvents.push({ type: 'SHIELD_HIT', x: tank.x, y: tank.y });
                            break; 
                        }

                        let isDead = false;
                        if (tank.inputs) { 
                            isDead = true; 
                        } else { 
                            const idx = this.enemies.indexOf(tank);
                            if (idx !== -1) isDead = hitEnemy(this, idx);
                        }

                        if (isDead) {
                            this.bulletEvents.push({ type: 'TANK_EXPLODE', x: tank.x, y: tank.y, isPlayer: !!tank.inputs });
                            if (tank.inputs) {
                                tank.isDead = true;
                                tank.lives--;
                                tank.respawnTimer = 180;
                                tank.x = -1000;
                            }
                        } else {
                            this.bulletEvents.push({ type: 'ARMOR_HIT', x: tank.x, y: tank.y });
                        }
                        break;
                    }
                }
            }
        });
    }

    applyBonus(player, type) {
        this.bulletEvents.push({ type: 'BONUS_TAKEN' });
        
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
        const priority = [4, 8, 0, 12];
        const col = priority[pIndex % priority.length];
        const team = this.teamManager.getTeam(teamId);
        const y = team ? team.spawnPixelY : 0;
        return { x: col * TILE_SIZE, y };
    }

    resetGame() {
        this.map = createLevel();
        this.bullets = [];
        this.enemies = [];
        this.pendingSpawns = [];
        this.activeBonus = null;
        this.isGameOver = false;
        this.gameOverTimer = 0;
        this.effectTimers = { shovel: 0, shovelTeam: 0, clock: 0, clockTeam: 0 };
        this.teamManager = new TeamManager();

        for (const id in this.players) {
            const p = this.players[id];
            p.isDead = false; p.isSpawning = true; p.spawnAnimTimer = 0;
            p.lives = 3; p.level = 1;
            const sp = this.getPlayerSpawnPoint(p.playerIndex, p.team);
            p.x = sp.x; p.y = sp.y;
            destroyBlockAt(this.map, p.x, p.y);
        }
    }

    broadcastState() {
        this.io.to(this.id).emit('state', {
            players: this.players,
            enemies: this.enemies,
            bullets: this.bullets,
            events: this.bulletEvents,
            map: this.map,
            bases: this.teamManager.getAllBases(),
            isGameOver: this.isGameOver,
            bonus: this.activeBonus,
            settings: this.settings
        });
    }

    destroy() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }
}