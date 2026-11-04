import { weaponPower } from './commander-v3.js';
import { DIRECTIONS, distance, liveTanks, shotAt } from './geometry.js';
import { clearPointV6, physicalV6, setTaskV6, strategyFields } from './timing-path-v6.js';

const axis = direction => ['UP', 'DOWN'].includes(direction) ? 'vertical' : 'horizontal';
const freeRole = task => task && ['fight', 'attack'].includes(task.kind) && !task.screen;
const shot = (room, bot, target, wantedAxis) => Object.keys(DIRECTIONS)
    .map(direction => shotAt(room, physicalV6(bot), direction, target))
    .find(value => value && !value.breach && value.distance <= 112 && (!wantedAxis || axis(value.direction) === wantedAxis));

function occupied(room, bot, point, partnerId) {
    return liveTanks(room).some(other => other.id !== bot.id && other.id !== partnerId
        && Math.abs(point.x - other.x) < 16 && Math.abs(point.y - other.y) < 16);
}
function applyPair(controller, plan, holder, flanker, target) {
    const extra = { crossfire: true, crossfireTargetId: target.id, focusTarget: physicalV6(target),
        crossfireUntil: plan.until, maxShotDistance: 128 };
    setTaskV6(controller, holder, { kind: 'guard', target: { ...plan.holdPoint }, ...extra, crossfireRole: 'hold' });
    setTaskV6(controller, flanker, { kind: 'guard', target: { ...plan.point }, ...extra, crossfireRole: 'flank' });
}

// Only a local pair is reassigned. Defenders, screens and the useful collector
// remain under the parent commander; no shot or cooldown is ever held for a volley.
export function withTeamV6(Base, { enabled = true, maxApproachTicks = 96, hysteresisTicks = 48 } = {}) {
    return class CrossfireV6 extends Base {
        reset() { super.reset(); this.crossfirePlansV6 = new Map(); this.strategyFieldsV6 = new Map(); }
        assignTasks() {
            super.assignTasks();
            if (!enabled) return;
            const room = this.room, all = liveTanks(room);
            for (const team of [1, 2]) {
                const fields = strategyFields(this, 'crossfire', 8, team);
                const bots = room.enemies.filter(bot => bot.team === team && freeRole(this.tasks.get(bot.id)));
                const old = this.crossfirePlansV6.get(team);
                const oldTarget = old && all.find(target => target.id === old.targetId && target.team !== team);
                const holder = old && bots.find(bot => bot.id === old.holderId), flanker = old && bots.find(bot => bot.id === old.flankerId);
                if (old && this.tick < old.until && oldTarget && holder && flanker
                    && distance(oldTarget, old.origin) <= 16 && distance(holder, flanker) >= 16
                    && shot(room, { ...physicalV6(holder), ...old.holdPoint }, oldTarget, old.holdAxis)
                    && shot(room, { ...physicalV6(flanker), ...old.point }, oldTarget, old.flankAxis)
                    && clearPointV6(room, flanker, old.point) && !occupied(room, flanker, old.point, holder.id)) {
                    applyPair(this, old, holder, flanker, oldTarget);
                    continue;
                }
                this.crossfirePlansV6.delete(team);
                if (bots.length < 2) continue;
                const targets = all.filter(target => target.team !== team
                    && (weaponPower(target) >= 6 || target.hp >= 2)
                    && bots.filter(bot => distance(bot, target) <= 112).length >= 2)
                    .sort((a, b) => (weaponPower(b) + (b.hp || 1) * 2) - (weaponPower(a) + (a.hp || 1) * 2)
                        || distance(bots[0], a) - distance(bots[0], b));
                let best = null;
                // Two contacts, four participants per contact and four
                // fields per planning team are hard caps (eight total).
                for (const target of targets.slice(0, 2)) {
                    const local = bots.filter(bot => distance(bot, target) <= 112)
                        .sort((a, b) => distance(a, target) - distance(b, target)).slice(0, 4);
                    for (const anchor of local) {
                        const current = shot(room, anchor, target);
                        if (!current) continue;
                        const holdAxis = axis(current.direction), flankAxis = holdAxis === 'vertical' ? 'horizontal' : 'vertical';
                        const holdPoint = { x: Math.round(anchor.x / 8) * 8, y: Math.round(anchor.y / 8) * 8 };
                        if (!clearPointV6(room, anchor, holdPoint) || !shot(room, { ...physicalV6(anchor), ...holdPoint }, target, holdAxis)) continue;
                        for (const mover of local) {
                            if (mover.id === anchor.id) continue;
                            // If both axes are already covered, preserve those positions.
                            const existing = shot(room, mover, target, flankAxis);
                            const candidates = [];
                            if (existing) candidates.push({ x: Math.round(mover.x / 8) * 8, y: Math.round(mover.y / 8) * 8 });
                            for (const offset of [-48, -32, 32, 48]) {
                                candidates.push(flankAxis === 'horizontal'
                                    ? { x: Math.round(target.x / 8) * 8 + offset, y: Math.round(target.y / 8) * 8 }
                                    : { x: Math.round(target.x / 8) * 8, y: Math.round(target.y / 8) * 8 + offset });
                            }
                            const field = fields.get(mover);
                            if (!field) continue;
                            for (const point of candidates) {
                                if (distance(point, holdPoint) < 24 || occupied(room, mover, point, anchor.id)
                                    || !shot(room, { ...physicalV6(mover), ...point }, target, flankAxis)) continue;
                                const route = field.at(point);
                                if (route.ticks > maxApproachTicks) continue;
                                const cover = Object.keys(DIRECTIONS).some(direction => {
                                    const counter = shotAt(room, physicalV6(target), direction, { ...point, width: 16, height: 16 });
                                    return counter && !counter.breach;
                                });
                                const score = route.ticks + (cover && !mover.shieldTimer ? 12 : 0)
                                    + Math.abs(distance(point, target) - 40) / 4
                                    - Math.min(20, weaponPower(target)) - (old?.flankerId === mover.id && old?.holderId === anchor.id ? 12 : 0);
                                if (!best || score < best.score) best = { score, target, holder: anchor, flanker: mover, point, holdPoint, holdAxis, flankAxis };
                            }
                        }
                    }
                    if (best) break;
                }
                if (best) {
                    const plan = { targetId: best.target.id, holderId: best.holder.id, flankerId: best.flanker.id,
                        point: best.point, holdPoint: best.holdPoint, holdAxis: best.holdAxis, flankAxis: best.flankAxis,
                        origin: { x: best.target.x, y: best.target.y }, until: this.tick + hysteresisTicks };
                    this.crossfirePlansV6.set(team, plan);
                    applyPair(this, plan, best.holder, best.flanker, best.target);
                }
            }
        }
    };
}
