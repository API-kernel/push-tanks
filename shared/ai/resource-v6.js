import { TANK_STATS, CLOCK_DURATION, HELMET_DURATION, SHOVEL_DURATION } from '../config.js';
import { distance, liveTanks } from './geometry.js';
import { baseLaneTimingV6 } from './objective-timing-v6.js';
import { physicalV6, setTaskV6, strategyFields } from './timing-path-v6.js';

// Utility is the effect the engine will actually apply, expressed as a budget
// of travel ticks. Control type is consulted only for clock's explicit rules.
export function bonusUtilityV6(room, tank, bonus) {
    const level = tank.level || 1, opponents = liveTanks(room).filter(other => other.team !== tank.team);
    if (bonus.type === 'star' || bonus.type === 'gun') {
        const after = bonus.type === 'gun' ? 4 : Math.min(4, level + 1), stats = TANK_STATS.player.levels[after];
        const restoredHp = Math.max(tank.baseHp || 1, stats.hp);
        const healing = Math.max(0, restoredHp - (tank.hp || 1));
        return (after - level) * 30 + healing * 65;
    }
    if (bonus.type === 'helmet') return 55 * Math.max(0, 1 - (tank.shieldTimer || 0) / HELMET_DURATION);
    if (bonus.type === 'grenade') return opponents.reduce((value, other) => value + 45 + Math.min(4, other.hp || 1) * 12, 0);
    if (bonus.type === 'clock') {
        const affected = room.enemies.filter(other => other.team !== tank.team).length;
        const remaining = room.effectTimers.clockTeam === tank.team ? room.effectTimers.clock : 0;
        return affected * 32 * Math.max(0, 1 - remaining / CLOCK_DURATION);
    }
    if (bonus.type === 'shovel') {
        const home = room.teamManager.getAllBases().find(base => base.team === tank.team && !base.isDead);
        if (!home) return 0;
        const remaining = room.effectTimers.shovels[tank.team] || 0;
        const threat = opponents.some(other => distance(other, home) < 112);
        return (threat ? 105 : 30) * Math.max(0, 1 - remaining / SHOVEL_DURATION);
    }
    return bonus.type === 'tank' ? 55 : 0;
}

export function bonusRouteV6(field, bonus) {
    // Use the same 10px pickup rectangle as checkBonusCollection. Graph goals
    // stay inside it; the actual engine decides collection on movement.
    return field?.best(point => Math.abs(point.x - bonus.x) <= 8 && Math.abs(point.y - bonus.y) <= 8 ? 0 : Infinity)
        || { ticks: Infinity, path: [] };
}
function fallbackTask(room, bot) {
    const opponents = liveTanks(room).filter(target => target.team !== bot.team)
        .sort((a, b) => distance(bot, a) - distance(bot, b));
    const enemyBase = room.teamManager.getAllBases().find(base => base.team !== bot.team && !base.isDead);
    const local = opponents.find(target => distance(bot, target) < 80);
    if (local || !enemyBase) return opponents.length ? { kind: 'fight', target: physicalV6(local || opponents[0]), maxShotDistance: 128, preferredRange: 40 }
        : { kind: 'guard', target: { x: bot.x, y: bot.y } };
    return { kind: 'attack', target: { ...enemyBase }, maxShotDistance: 208, preferredRange: 48 };
}

export function withResourceV6(Base, { enabled = true, maxTravelTicks = 210, hysteresisTicks = 24 } = {}) {
    return class ResourceV6 extends Base {
        reset() { super.reset(); this.resourceCollectorsV6 = new Map(); }
        assignTasks() {
            super.assignTasks();
            if (!enabled) return;
            const room = this.room, bonus = room.activeBonus;
            if (!bonus) { this.resourceCollectorsV6.clear(); return; }
            const key = `${bonus.type}:${bonus.x}:${bonus.y}`, fields = strategyFields(this, 'resources', 8), all = liveTanks(room);
            for (const team of [1, 2]) {
                const home = room.teamManager.getAllBases().find(base => base.team === team && !base.isDead);
                const fatal = home ? Math.min(Infinity, ...all.filter(other => other.team !== team).map(other => {
                    const lane = baseLaneTimingV6(room, other, home);
                    return lane ? lane.ticks + Math.max(0, other.bulletTimer ?? other.bulletCooldown ?? 0) : Infinity;
                })) : Infinity;
                const eligible = room.enemies.filter(bot => {
                    const task = this.tasks.get(bot.id);
                    return bot.team === team && task && ['fight', 'attack', 'bonus'].includes(task.kind) && !task.crossfire;
                });
                const previous = this.resourceCollectorsV6.get(team);
                const bids = eligible.map(bot => ({ bot, utility: bonusUtilityV6(room, bot, bonus) }))
                    .filter(bid => bid.utility > 0)
                    .sort((a, b) => (distance(a.bot, bonus) / a.bot.speed - a.utility)
                        - (distance(b.bot, bonus) / b.bot.speed - b.utility));
                const continuing = bids.find(bid => previous?.key === key && bid.bot.id === previous.id);
                const candidates = [...new Set([continuing, ...bids.slice(0, 3)].filter(Boolean))];
                for (const bid of candidates) {
                    const field = fields.get(bid.bot, { allowBreach: true });
                    const route = bonusRouteV6(field, bonus);
                    bid.ticks = route.ticks; bid.route = route;
                    const urgent = fatal < 80 && !(bonus.type === 'grenade' && route.ticks + 8 < fatal);
                    bid.score = !urgent && route.ticks <= Math.min(maxTravelTicks, bid.utility + 45) ? route.ticks - bid.utility : Infinity;
                }
                candidates.sort((a, b) => a.score - b.score);
                let winner = candidates[0];
                if (continuing && Number.isFinite(continuing.score) && continuing.score <= (winner?.score ?? Infinity) + hysteresisTicks) winner = continuing;
                if (winner && Number.isFinite(winner.score)) {
                    const opponents = all.filter(other => other.team !== team)
                        .sort((a, b) => distance(a, bonus) / Math.max(.1, a.speed || .6) - distance(b, bonus) / Math.max(.1, b.speed || .6)).slice(0, 2);
                    let enemyEta = Infinity;
                    for (const opponent of opponents) {
                        if (distance(opponent, bonus) / Math.max(.1, opponent.speed || .6) > winner.ticks + 24) continue;
                        const field = fields.get(opponent, { allowBreach: true });
                        const frozen = room.enemies.includes(opponent) && room.effectTimers.clock > 0 && room.effectTimers.clockTeam !== opponent.team
                            ? room.effectTimers.clock : 0;
                        enemyEta = Math.min(enemyEta, bonusRouteV6(field, bonus).ticks + frozen);
                    }
                    // Do not race through a long detour after the opponent can
                    // collect. A small tie margin keeps established collectors.
                    if (enemyEta + 16 < winner.ticks) winner = null;
                    const readyAlly = all.some(other => other.team === team && other.id !== winner?.bot.id
                        && Math.abs(other.x - bonus.x) < 16 && Math.abs(other.y - bonus.y) < 16
                        && distance(other, bonus) + 8 < distance(winner?.bot || bonus, bonus));
                    if (readyAlly) winner = null;
                }
                for (const bot of eligible) {
                    if (this.tasks.get(bot.id)?.kind === 'bonus' && bot.id !== winner?.bot.id) {
                        const fallback = fallbackTask(room, bot);
                        if (fallback) setTaskV6(this, bot, fallback);
                    }
                }
                if (winner && Number.isFinite(winner.score)) {
                    setTaskV6(this, winner.bot, { kind: 'bonus', target: { x: bonus.x, y: bonus.y, type: bonus.type },
                        resourceV6: true, arrivalTicks: winner.ticks, bonusUtility: winner.utility });
                    this.resourceCollectorsV6.set(team, { id: winner.bot.id, key });
                    this.collectors?.set(team, { id: winner.bot.id, key });
                } else this.resourceCollectorsV6.delete(team);
            }
        }
    };
}
