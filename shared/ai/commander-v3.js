import { TacticalV2 } from './tactical-v2.js';
import { TANK_STATS } from '../config.js';
import { DIRECTIONS, distance, liveTanks, shotAt } from './geometry.js';

export function weaponPower(tank) {
    const upgrade = TANK_STATS.player.levels[tank.level || 1];
    const speed = tank.bulletSpeed ?? upgrade.bulletSpeed;
    const cooldown = tank.bulletCooldownMax ?? upgrade.cooldown;
    return speed * 60 / Math.max(12, cooldown);
}

function physicalSnapshot(target) {
    return { id: target.id, team: target.team, x: target.x, y: target.y,
        width: target.width || 16, height: target.height || 16,
        hp: target.hp, speed: target.speed, direction: target.direction,
        level: target.level || 1, isMoving: target.isMoving,
        shieldTimer: target.shieldTimer || 0, bulletSpeed: target.bulletSpeed,
        bulletTimer: target.bulletTimer, bulletCooldown: target.bulletCooldown,
        bulletCooldownMax: target.bulletCooldownMax };
}

// Team decisions are composed with independently tested navigation and combat policies.
export class TacticalCommander extends TacticalV2 {
    reset() {
        super.reset();
        this.collectors = new Map();
    }

    prepare() {
        this.tick++;
        const alive = new Set(this.room.enemies.map(b => b.id));
        for (const id of this.memory.keys()) if (!alive.has(id)) this.memory.delete(id);
        if (this.tick % 8 === 1 || this.room.enemies.some(b => !this.tasks.has(b.id))) this.assignTasks();
    }

    assignTasks() {
        const room = this.room;
        const all = liveTanks(room);
        const bases = room.teamManager.getAllBases().filter(b => !b.isDead);
        this.tasks.clear();
        for (const team of [1, 2]) {
            const bots = room.enemies.filter(b => b.team === team);
            const opponents = all.filter(t => t.team !== team).map(physicalSnapshot);
            const home = bases.find(b => b.team === team);
            const enemyBase = bases.find(b => b.team !== team);
            const available = new Set(bots);
            const assigned = new Map();
            const threat = target => {
                if (!home) return 0;
                const d = distance(target, home);
                const shot = Object.keys(DIRECTIONS).map(dir => shotAt(room, target, dir, home))
                    .find(s => s && !s.breach);
                const arrival = d / Math.max(.3, target.speed || .6);
                return (shot ? 160 : 0) + Math.max(0, 88 - d)
                    + (arrival < 100 ? 35 : 0) + (d < 112 ? Math.min(25, weaponPower(target) * 3) : 0);
            };
            const threats = opponents.map(target => ({ target, score: threat(target) }))
                .filter(t => t.score >= 40).sort((a, b) => b.score - a.score);
            const setTask = (bot, kind, target, extra = {}) => {
                this.tasks.set(bot.id, { kind, target: physicalSnapshot(target), ...extra });
                available.delete(bot);
                if (target.id !== undefined) assigned.set(target.id, (assigned.get(target.id) || 0) + 1);
            };
            const defenderCount = threats.length ? Math.min(bots.length,
                Math.max(1, Math.min(bots.length - 1, Math.ceil(threats.length * .7) + (threats[0].score >= 160 ? 1 : 0)))) : 0;
            for (let index = 0; index < defenderCount; index++) {
                const target = threats[index % threats.length].target;
                const defender = [...available].sort((a, b) =>
                    (distance(a, target) / a.speed - Math.min(12, a.hp * 3))
                    - (distance(b, target) / b.speed - Math.min(12, b.hp * 3)) || a.id - b.id)[0];
                if (defender) setTask(defender, 'defend', target, { maxShotDistance: 128, preferredRange: 40 });
            }

            const bonus = room.activeBonus;
            if (bonus && (!threats.length || threats[0].score < 160)) {
                const utility = bot => {
                    if (bonus.type === 'gun') return bot.level < 4 ? 100 : 0;
                    if (bonus.type === 'star') return bot.level < 4 ? 70 : 0;
                    if (bonus.type === 'helmet') return bot.shieldTimer > 60 ? 0 : 45;
                    if (bonus.type === 'shovel') return home ? (threats.length ? 100 : 25) : 0;
                    if (bonus.type === 'clock') return opponents.length ? 80 : 10;
                    if (bonus.type === 'grenade') return opponents.length ? 100 : 10;
                    return 50;
                };
                const bid = bot => distance(bot, bonus) / Math.max(.3, bot.speed) - utility(bot);
                const candidates = [...available].filter(b => utility(b) > 0 && distance(b, bonus) < 160).sort((a, b) => bid(a) - bid(b) || a.id - b.id);
                const previous = this.collectors.get(team);
                const continuing = candidates.find(b => b.id === previous?.id && previous.key === `${bonus.type}:${bonus.x}:${bonus.y}`);
                const collector = continuing && bid(continuing) <= bid(candidates[0]) + 24 ? continuing : candidates[0];
                if (collector) {
                    const closerAlly = all.some(t => t.team === team && t.id !== collector.id
                        && !bots.some(b => b.id === t.id) && distance(t, bonus) < 24 && distance(collector, bonus) > 32);
                    if (!closerAlly) {
                        setTask(collector, 'bonus', bonus);
                        this.collectors.set(team, { id: collector.id, key: `${bonus.type}:${bonus.x}:${bonus.y}` });
                    }
                }
            }

            let lane = 0;
            for (const bot of available) {
                const scored = opponents.map(target => {
                    const d = distance(bot, target);
                    const dangerous = weaponPower(target) >= 8;
                    const capacityPenalty = (assigned.get(target.id) || 0) * 45 / Math.max(1, target.hp || 1);
                    return { target, d, dangerous, score: d + capacityPenalty - Math.min(30, weaponPower(target) * 2) - threat(target) / 4 };
                }).sort((a, b) => a.score - b.score);
                const local = scored.find(t => t.d < (t.dangerous ? 112 : 80));
                if (local || !enemyBase) {
                    const target = local?.target || scored[0]?.target;
                    if (target) setTask(bot, 'fight', target, { maxShotDistance: 128, preferredRange: 40 });
                } else {
                    const side = lane++ % 2 ? 1 : -1;
                    setTask(bot, 'attack', enemyBase, {
                        maxShotDistance: 208, preferredRange: 48,
                        approach: { x: enemyBase.x + side * 32, y: team === 1 ? 32 : 160 }
                    });
                }
            }
        }
    }
}
