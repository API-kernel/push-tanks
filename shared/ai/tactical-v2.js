import { TacticalAI as TacticalV1 } from './tactical-v1.js';
import { MAP_WIDTH, MAP_HEIGHT } from '../config.js';
import { updateTankMovement } from '../tank.js';
import { createBullet } from '../bullet.js';
import { checkRectOverlap } from '../utils.js';
import { DIRECTIONS, distance, firstWall, liveTanks, shotAt } from './geometry.js';

// Experimental successor. Keep v1 and its navigation/geometry unchanged as opponents.
export class TacticalV2 extends TacticalV1 {
    assignTasks() {
        super.assignTasks();
        const room = this.room;
        const bases = room.teamManager.getAllBases().filter(b => !b.isDead);
        // A permanent idle defender loses initiative. Reinforce when an actual threat appears.
        for (const bot of room.enemies) {
            const task = this.tasks.get(bot.id);
            if (task?.kind !== 'guard') continue;
            const enemyBase = bases.find(b => b.team !== bot.team);
            if (enemyBase) this.tasks.set(bot.id, { kind: 'attack', target: { ...enemyBase } });
        }
    }

    chooseShot(bot, task, waypoint) {
        const room = this.room;
        const home = room.teamManager.getAllBases().find(b => b.team === bot.team && !b.isDead);
        const opponents = liveTanks(room).filter(t => t.team !== bot.team);
        const previews = opponents.map(t => ({ ...t }));
        const shots = Object.keys(DIRECTIONS).map(direction => {
            const bullet = createBullet({ ...bot, direction }, bot.bulletSpeed);
            const wall = firstWall(room, bullet, 208);
            return { direction, bullet, wall };
        });
        let best = null;
        const consider = (shot, score) => {
            if (shot && score > 0 && (!best || score > best.score)) best = { ...shot, score };
        };
        // Predict both movement and contact with cover, rather than leading through walls.
        for (let tick = 1; tick <= 64; tick++) {
            for (let i = 0; i < previews.length; i++) {
                const target = previews[i];
                if (opponents[i].isMoving) updateTankMovement(target, target.direction, MAP_WIDTH, MAP_HEIGHT,
                    room.map, room.checkGlobalCollision.bind(room));
                if (target.shieldTimer >= tick) continue;
                for (const shot of shots) {
                    const [dx, dy] = DIRECTIONS[shot.direction];
                    const d = tick * bot.bulletSpeed;
                    if (d > 208 || (shot.wall && d >= shot.wall.distance)) continue;
                    const projectile = { ...shot.bullet,
                        x: shot.bullet.x + dx * d - (dx > 0 ? bot.bulletSpeed : 0),
                        y: shot.bullet.y + dy * d - (dy > 0 ? bot.bulletSpeed : 0),
                        width: 4 + Math.abs(dx * bot.bulletSpeed), height: 4 + Math.abs(dy * bot.bulletSpeed) };
                    if (!checkRectOverlap(projectile, target)) continue;
                    const solution = shotAt(room, bot, shot.direction, target);
                    if (!solution || solution.breach) continue;
                    const baseThreat = home && distance(target, home) < 88;
                    consider(solution, 110 + (baseThreat ? 45 : 0) + (target.hp <= 1 ? 8 : 0) - tick * .8);
                }
            }
        }
        // Real exposed bases remain a win condition, not a distraction behind hard cover.
        for (const base of room.teamManager.getAllBases()) {
            if (base.team === bot.team || base.isDead) continue;
            for (const direction of Object.keys(DIRECTIONS)) {
                const shot = shotAt(room, bot, direction, base);
                if (shot) consider(shot, (shot.breach ? 65 : 155) - shot.distance / 6);
            }
        }
        // Breach only as part of the current route or when threatening an actual opponent.
        if (waypoint) {
            for (const direction of Object.keys(DIRECTIONS)) {
                const shot = shotAt(room, bot, direction, { ...waypoint, width: 16, height: 16 });
                if (shot?.breach) consider(shot, 40 - shot.distance / 8);
            }
        }
        for (const target of opponents) {
            for (const direction of Object.keys(DIRECTIONS)) {
                const shot = shotAt(room, bot, direction, target);
                if (shot?.breach) consider(shot, 35 - shot.distance / 8);
            }
        }
        // Head-on interception only: firing at a shell moving sideways wastes the cooldown.
        const opposite = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
        for (const bullet of room.bullets) {
            if (bullet.isDead || bullet.team === bot.team || distance(bot, bullet) > 80) continue;
            const shot = shotAt(room, bot, opposite[bullet.direction], bullet);
            if (shot && !shot.breach) consider(shot, 125 - shot.distance / 6);
        }
        return best;
    }

    incoming(bot) {
        const bullets = super.incoming(bot);
        // Anticipate a visible opponent already aiming down a clear firing lane.
        // The same physical cooldown rule applies to human-controlled and automatic tanks.
        for (const target of liveTanks(this.room)) {
            if (target.team === bot.team || distance(bot, target) > 112) continue;
            const cooldown = Math.max(0, target.bulletTimer ?? target.bulletCooldown ?? 0);
            if (cooldown > 10) continue;
            const shot = shotAt(this.room, target, target.direction, bot);
            if (!shot || shot.breach) continue;
            const bullet = createBullet(target, target.bulletSpeed || (target.level >= 2 ? 250 / 60 : 125 / 60));
            bullets.push({ ...bullet, reach: Infinity, predicted: true, delay: cooldown + 3 });
        }
        return bullets;
    }

    movementRisk(bot, direction, bullets) {
        const real = bullets.filter(b => !b.predicted);
        let risk = super.movementRisk(bot, direction, real);
        if (risk || bot.shieldTimer > 28) return risk;
        const anticipated = bullets.filter(b => b.predicted);
        if (!anticipated.length) return 0;
        const preview = { ...bot };
        for (let tick = 1; tick <= 28; tick++) {
            updateTankMovement(preview, direction, MAP_WIDTH, MAP_HEIGHT, this.room.map,
                this.room.checkGlobalCollision.bind(this.room));
            for (const bullet of anticipated) {
                if (tick <= bullet.delay) continue;
                const [dx, dy] = DIRECTIONS[bullet.direction];
                const d = (tick - bullet.delay) * bullet.speed;
                if (checkRectOverlap(preview, { ...bullet, x: bullet.x + dx * d, y: bullet.y + dy * d })) risk = Math.max(risk, 70);
            }
        }
        return risk;
    }
}
