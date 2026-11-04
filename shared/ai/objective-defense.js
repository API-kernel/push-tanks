import { createBullet } from '../bullet.js';
import { checkRectOverlap } from '../utils.js';
import { DIRECTIONS, distance, liveTanks, shotAt, wallAt } from './geometry.js';
import { terrainCost } from './navigation-v2.js';

export function projectileThreatensBase(room, source, base, horizon = 80) {
    const bullet = { ...source };
    const [dx, dy] = DIRECTIONS[bullet.direction];
    const steps = Math.ceil(bullet.speed / 2);
    for (let tick = 1; tick <= horizon; tick++) {
        for (let step = 0; step < steps; step++) {
            if (wallAt(room.map, bullet)) return false;
            bullet.x += dx * bullet.speed / steps;
            bullet.y += dy * bullet.speed / steps;
            if (bullet.x < 0 || bullet.y < 0 || bullet.x > 208 || bullet.y > 208) return false;
        }
        if (checkRectOverlap(bullet, base)) return true;
    }
    return false;
}

function shieldScreen(controller) {
    const room = controller.room;
    for (const home of room.teamManager.getAllBases().filter(b => !b.isDead)) {
        const threats = liveTanks(room).filter(t => t.team !== home.team && t.shieldTimer > 30 && distance(t, home) < 112);
        for (const target of threats) {
            const shooter = { id: target.id, team: target.team, x: target.x, y: target.y,
                direction: target.direction, level: target.level || 1, bulletSpeed: target.bulletSpeed };
            const shots = Object.keys(DIRECTIONS).map(direction => shotAt(room, shooter, direction, home)).filter(Boolean)
                .sort((a, b) => a.distance - b.distance);
            if (!shots.length) continue;
            const shot = shots[0], bullet = createBullet({ ...shooter, direction: shot.direction }, 2);
            const vertical = shot.direction === 'UP' || shot.direction === 'DOWN';
            const points = [-8, 0, 8].map(offset => vertical
                ? { x: Math.round(target.x / 8) * 8 + offset, y: home.y + (home.y === 0 ? 24 : -24) }
                : { x: home.x + (target.x < home.x ? -32 : 32), y: home.y + offset });
            const defenders = room.enemies.filter(b => b.team === home.team && controller.tasks.get(b.id)?.kind === 'defend');
            let best = null;
            for (const defender of defenders) for (const point of points) {
                const intersects = vertical ? bullet.x < point.x + 16 && bullet.x + 4 > point.x
                    : bullet.y < point.y + 16 && bullet.y + 4 > point.y;
                if (!intersects || terrainCost(room, defender, point) !== 1) continue;
                const score = distance(defender, point) / defender.speed - defender.hp * 3;
                if (!best || score < best.score) best = { defender, point, score };
            }
            if (best) {
                const task = { kind: 'guard', target: { ...best.point }, screen: true, screenThreatId: target.id };
                controller.tasks.set(best.defender.id, task);
                controller.strategicTasks?.set(best.defender.id, task);
                break; // keep other defenders attacking instead of forming a pile
            }
        }
    }
}

// Sacrificing an expendable tank can be correct when the alternative is losing
// the base. Never suppress evasion for shells stopped by intact fortifications.
export function withObjectiveDefense(Base) {
    return class ObjectiveDefense extends Base {
        reset() { super.reset(); this.baseThreatCache = new Map(); }
        prepare() { super.prepare(); this.baseThreatCache.clear(); }
        assignTasks() { super.assignTasks(); shieldScreen(this); }
        movementRisk(bot, direction, bullets) {
            if (!this.tasks.get(bot.id)?.screen) return super.movementRisk(bot, direction, bullets);
            const home = this.room.teamManager.getAllBases().find(b => b.team === bot.team && !b.isDead);
            if (!home) return super.movementRisk(bot, direction, bullets);
            const ordinary = bullets.filter(bullet => {
                if (bullet.predicted) return true;
                const key = `${home.team}:${bullet.x}:${bullet.y}:${bullet.direction}:${bullet.speed}`;
                if (!this.baseThreatCache.has(key)) this.baseThreatCache.set(key, projectileThreatensBase(this.room, bullet, home));
                return !this.baseThreatCache.get(key);
            });
            return super.movementRisk(bot, direction, ordinary);
        }
    };
}
