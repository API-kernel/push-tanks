import { TacticalV3 } from './tactical-v3.js';
import { TacticalV2 } from './tactical-v2.js';
import { withNavigationV4 } from './navigation-v4.js';
import { chooseTacticalSpawn } from './spawn-strategy.js';
import { weaponPower } from './commander-v3.js';
import { distance, liveTanks } from './geometry.js';

function physicalState(tank) {
    const result = {};
    for (const field of ['id', 'team', 'x', 'y', 'width', 'height', 'hp', 'level', 'speed',
        'direction', 'shieldTimer', 'isMoving', 'lastDirection', 'slideTimer',
        'isDead', 'isSpawning', 'lives', 'bulletSpeed', 'bulletCooldownMax', 'bulletTimer', 'bulletCooldown']) result[field] = tank[field];
    return result;
}

// Adapt to observable weapon capabilities, never to the human/bot identity.
// Simple opponents reward uninterrupted strategic progress; rapid-fire opponents
// require the more conservative uncertainty-aware combat and short dodge search.
export class TacticalV4 extends withNavigationV4(TacticalV3) {
    reset() {
        super.reset();
        this.combatModes = new Map();
        this.strategicTasks = new Map();
    }

    prepare() {
        super.prepare();
        const alive = new Set(this.room.enemies.map(b => b.id));
        for (const id of this.combatModes.keys()) if (!alive.has(id)) this.combatModes.delete(id);
    }

    assignTasks() {
        super.assignTasks();
        this.strategicTasks = new Map(this.tasks);
    }

    advancedCombat(bot) {
        let state = this.combatModes.get(bot.id);
        if (state?.tick === this.tick) return state.active;
        const dangerous = liveTanks(this.room).some(target => target.team !== bot.team
            && distance(bot, target) <= 160 && weaponPower(target) >= 6);
        const until = dangerous ? this.tick + 30 : state?.until || 0;
        state = { tick: this.tick, until, active: dangerous || this.tick < until };
        this.combatModes.set(bot.id, state);
        return state.active;
    }

    publicRoom() {
        const view = Object.create(this.room);
        view.enemies = this.room.enemies.map(physicalState);
        view.players = Object.fromEntries(Object.entries(this.room.players).map(([id, tank]) => [id, physicalState(tank)]));
        view.checkGlobalCollision = this.room.checkGlobalCollision.bind(this.room);
        return view;
    }

    chooseShot(bot, task, waypoint) {
        if (this.advancedCombat(bot)) return super.chooseShot(bot, task, waypoint);
        return TacticalV2.prototype.chooseShot.call({ room: this.publicRoom() }, bot, task, waypoint);
    }

    incoming(bot) {
        if (this.advancedCombat(bot)) return super.incoming(bot);
        return TacticalV2.prototype.incoming.call({ room: this.publicRoom() }, bot);
    }

    movementRisk(bot, direction, bullets) {
        return this.advancedCombat(bot) ? super.movementRisk(bot, direction, bullets)
            : TacticalV2.prototype.movementRisk.call(this, bot, direction, bullets);
    }

    combatMovementCost(bot, direction, context) {
        return this.advancedCombat(bot) ? super.combatMovementCost(bot, direction, context) : 0;
    }

    update(bot) {
        if (this.advancedCombat(bot)) {
            // Closing a static breaching stalemate helped older bot matchups but
            // regressed against upgraded fast opponents. Preserve an escape there.
            const progress = this.breachProgress.get(bot.id);
            if (progress) { progress.anchorTick = this.tick; progress.commitUntil = 0; }
            const strategic = this.strategicTasks.get(bot.id);
            if (strategic) this.tasks.set(bot.id, strategic);
            TacticalV3.prototype.update.call(this, bot);
        } else super.update(bot);
    }

    chooseSpawnPoint(team, busy, random) {
        return chooseTacticalSpawn(this.room, team, busy, random);
    }
}

export class TacticalV4RandomSpawn extends TacticalV4 {
    constructor(...args) { super(...args); this.chooseSpawnPoint = undefined; }
}
