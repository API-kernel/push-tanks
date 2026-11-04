import { TacticalV2 } from '../shared/ai/tactical-v2.js';
import { TANK_STATS } from '../shared/config.js';
import { DIRECTIONS, distance, liveTanks } from '../shared/ai/geometry.js';

export const PLAYER_POLICIES = ['duelist', 'rusher', 'evasive'];

// A test opponent, not a model of a human. It can only return ordinary input packets.
// The real GameRoom.updatePlayer enforces speed, cooldown, ammo, lives and respawning.
export class PlayerProxy {
    constructor(room, id, { policy = 'evasive', reaction = 6 } = {}) {
        this.room = room;
        this.id = id;
        this.policy = policy;
        this.reaction = reaction;
        this.tick = 0;
        this.inputs = {};
        this.shadow = Object.create(room);
        this.shadow.checkGlobalCollision = room.checkGlobalCollision.bind(room);
        this.controller = new TacticalV2(this.shadow);
    }

    decide() {
        const player = this.room.players[this.id];
        this.tick++;
        if (!player || player.isDead || player.isSpawning) {
            this.controller.memory.delete(this.id);
            return this.inputs = {};
        }
        if (this.tick % this.reaction !== 0) return this.inputs;
        const stats = TANK_STATS.player.levels[player.level || 1];
        const preview = { ...player, bulletTimer: player.bulletCooldown, bulletSpeed: stats.bulletSpeed,
            bulletCooldownMax: stats.cooldown };
        // Plans run against a shadow tank and private output arrays; they cannot move the real tank.
        this.shadow.bullets = [...this.room.bullets];
        this.shadow.bulletEvents = [];
        const enemies = liveTanks(this.room).filter(t => t.team !== player.team)
            .sort((a, b) => distance(player, a) - distance(player, b));
        const base = this.room.teamManager.getAllBases().find(b => b.team !== player.team && !b.isDead);
        const target = this.policy === 'rusher' ? (base || enemies[0]) : (enemies[0] || base);
        this.controller.tick = this.tick;
        if (target) this.controller.tasks.set(this.id, { kind: target === base ? 'attack' : 'fight', target: { ...target } });
        this.controller.update(preview);
        const fire = this.shadow.bullets.length > this.room.bullets.length;
        let direction = (preview.x !== player.x || preview.y !== player.y || fire) ? preview.direction : null;
        // Deliberate unpredictable lateral changes defeat simple constant-velocity leading.
        if (this.policy === 'evasive' && enemies[0] && distance(player, enemies[0]) < 112
            && Math.floor(this.tick / 24) % 3 === 1 && player.bulletCooldown > 0) {
            const vertical = Math.abs(enemies[0].x - player.x) < Math.abs(enemies[0].y - player.y);
            const turn = Math.floor(this.tick / 72) % 2 ? 1 : -1;
            direction = vertical ? (turn > 0 ? 'RIGHT' : 'LEFT') : (turn > 0 ? 'DOWN' : 'UP');
        }
        const [dx, dy] = DIRECTIONS[direction] || [0, 0];
        this.inputs = { up: dy < 0, down: dy > 0, left: dx < 0, right: dx > 0,
            fire: fire && direction === preview.direction, cheat0: false };
        return this.inputs;
    }
}
