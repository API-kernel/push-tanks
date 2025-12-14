import { checkRectOverlap } from './shared/utils.js';
import { hitEnemy } from './shared/enemy.js';

export class BattleSystem {
    constructor(room) {
        this.room = room; // Ссылка на комнату для доступа к данным
    }

    update() {
        const { bullets, enemies, players, teamManager } = this.room;
        
        // Собираем цели (Враги + Живые Игроки)
        // (Игроков берем из объекта values)
        const activePlayers = Object.values(players).filter(p => !p.isDead && !p.isSpawning);
        const targets = [...enemies, ...activePlayers];

        bullets.forEach(b => {
            if (b.isDead) return;

            // 1. ПУЛЯ vs ПУЛЯ
            for (const otherB of bullets) {
                if (b !== otherB && !otherB.isDead && b.team !== otherB.team) {
                    if (checkRectOverlap(b, otherB)) {
                        b.isDead = true; otherB.isDead = true;
                        this.room.bulletEvents.push({ type: 'BULLET_CLASH', x: b.x, y: b.y });
                    }
                }
            }
            if (b.isDead) return;

            // 2. ПУЛЯ vs БАЗА
            const bases = teamManager.getAllBases();
            bases.forEach(base => {
                if (base.isDead) return;
                if (checkRectOverlap(b, base)) {
                    b.isDead = true;

                    if (b.ownerId >= 1000 && b.team === base.team) {
                         return; // Урон не наносим
                    }

                    teamManager.destroyBase(base.team);
                    
                    this.room.bulletEvents.push({ type: 'BASE_DESTROY', x: base.x, y: base.y });
                    const winnerId = (base.team === 1) ? 2 : 1;
                    this.room.handleVictory(winnerId);
                }
            });
            if (b.isDead) return;

            // 3. ПУЛЯ vs ТАНК
            for (const tank of targets) {
                // Огонь по своим отключен (b.team !== tank.team)
                // Огонь по себе отключен (b.ownerId !== tank.id)
                // Добавляем friendlyFire из настроек, если нужно
                
                if (b.team !== tank.team) {
                    if (checkRectOverlap(b, tank)) {
                        b.isDead = true;
                        
                        // Щит
                        if (tank.shieldTimer > 0) {
                            this.room.bulletEvents.push({ type: 'SHIELD_HIT', x: tank.x, y: tank.y });
                            break; 
                        }

                        let isDead = false;
                        let wasBonus = false;

                        // Логика получения урона
                        if (tank.inputs) { 
                            // ЭТО ИГРОК
                            isDead = true; // Игрок умирает с 1 попадания
                            const killer = this.getOwnerName(b.ownerId);
                            this.room.sendSystemMessage(`${tank.nickname} killed by ${killer}`);
                        } else { 
                            // ЭТО БОТ
                            const idx = enemies.indexOf(tank);
                            if (idx !== -1) {
                                wasBonus = tank.isBonus;
                                // Передаем this.room в hitEnemy
                                const res = hitEnemy(this.room, idx);
                                isDead = res.isDead;
                            }
                        }

                        if (isDead) {
                            this.room.bulletEvents.push({ type: 'TANK_EXPLODE', x: tank.x, y: tank.y, isPlayer: !!tank.inputs });
                            
                            // Если умер Игрок - ставим таймер
                            if (tank.inputs) {
                                tank.isDead = true;
                                tank.lives--;
                                tank.respawnTimer = 90; // 1.5 сек (как мы договорились)
                                tank.x = -1000;
                            }
                            
                            // Если умер бонусный танк (логика звука)
                            if (wasBonus) {
                                this.room.bulletEvents.push({ type: 'BONUS_SPAWN' });
                            }

                        } else {
                            // Броня
                            this.room.bulletEvents.push({ type: 'ARMOR_HIT', x: tank.x, y: tank.y });
                        }
                        break;
                    }
                }
            }
        });
    }

    getOwnerName(ownerId) {
        // Игрок?
        const player = this.room.players[ownerId]; // ownerId может быть socketId_idx (строка)
        
        if (player) return player.nickname || "Player";
        
        // Бот?
        if (typeof ownerId === 'number' && ownerId >= 1000) {
            return `Bot #${ownerId}`;
        }
        
        if (this.room.players[ownerId]) return this.room.players[ownerId].nickname;
        
        return "Unknown";
    }
}