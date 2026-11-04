import { TANK_STATS } from '../config.js';
import { DIRECTIONS, distance, liveTanks, shotAt } from './geometry.js';

// Report the actual star/gun effect. In particular, a level-one bot's star can
// change cooldown 60 -> 12, while level-four heavy tanks can still regain HP.
export function weaponBonusEffectV6(tank, type) {
    if (type !== 'star' && type !== 'gun') return null;
    const level = tank.level || 1, after = type === 'gun' ? 4 : Math.min(4, level + 1);
    const before = TANK_STATS.player.levels[level], stats = TANK_STATS.player.levels[after];
    const hp = Math.max(tank.baseHp || 1, stats.hp);
    const bulletSpeed = Math.max(tank.bulletSpeed ?? before.bulletSpeed, stats.bulletSpeed);
    const cooldown = Math.min(tank.bulletCooldownMax ?? before.cooldown, stats.cooldown);
    return { level: after, hp, healing: Math.max(0, hp - (tank.hp || 1)), bulletSpeed, cooldown,
        steelUnlocked: level < 4 && after === 4 };
}

// Keep the parent's normal bonus selection, routes, race assumptions and task
// distribution. Fill only its missing repair case when no collector exists.
export function withResourceHealingV6(Base, { enabled = true } = {}) {
    return class ResourceHealingV6 extends Base {
        assignTasks() {
            super.assignTasks();
            const room = this.room, bonus = room.activeBonus;
            if (!enabled || !bonus || !['star', 'gun'].includes(bonus.type)) return;
            const all = liveTanks(room), key = `${bonus.type}:${bonus.x}:${bonus.y}`;
            for (const team of [1, 2]) {
                const bots = room.enemies.filter(bot => bot.team === team);
                if (bots.some(bot => this.tasks.get(bot.id)?.kind === 'bonus')) continue;
                const home = room.teamManager.getAllBases().find(base => base.team === team && !base.isDead);
                // This is the V5 bonus gate: its non-line threat terms cannot
                // reach 160, whereas any exposed base line contributes 160.
                const exposed = home && all.some(target => target.team !== team && Object.keys(DIRECTIONS).some(direction => {
                    const shooter = { id: target.id, team: target.team, x: target.x, y: target.y,
                        level: target.level, bulletSpeed: target.bulletSpeed };
                    const shot = shotAt(room, shooter, direction, home);
                    return shot && !shot.breach;
                }));
                if (exposed) continue;
                const bid = bot => distance(bot, bonus) / Math.max(.3, bot.speed);
                const candidates = bots.filter(bot => {
                    const task = this.tasks.get(bot.id);
                    return (bot.level || 1) === 4 && weaponBonusEffectV6(bot, bonus.type).healing > 0
                        && task && ['fight', 'attack'].includes(task.kind) && !task.screen && !task.crossfire
                        && distance(bot, bonus) < 160;
                }).sort((a, b) => bid(a) - bid(b) || a.id - b.id);
                const previous = this.collectors?.get(team);
                const continuing = candidates.find(bot => previous?.key === key && bot.id === previous.id);
                const collector = continuing && bid(continuing) <= bid(candidates[0]) + 24 ? continuing : candidates[0];
                if (!collector) continue;
                const botIds = new Set(bots.map(bot => bot.id));
                const closerAlly = all.some(target => target.team === team && target.id !== collector.id
                    && !botIds.has(target.id) && distance(target, bonus) < 24 && distance(collector, bonus) > 32);
                if (closerAlly) continue;
                const task = { kind: 'bonus', target: { x: bonus.x, y: bonus.y,
                    width: bonus.width || 16, height: bonus.height || 16 }, resourceHealingV6: true };
                this.tasks.set(collector.id, task); this.strategicTasks?.set(collector.id, task);
                this.collectors?.set(team, { id: collector.id, key });
            }
        }
    };
}
