import { TacticalV4 } from './tactical-v4.js';
import { withCombatV4 } from './combat-v4.js';
import { withObjectiveDefense } from './objective-defense.js';

class AdaptiveObjectives extends withCombatV4(TacticalV4, { steering: true, baseDefense: true }) {
    combatMovementCost(bot, ...args) {
        // Base matches reward keeping a useful firing position while covering
        // an approach. Without bases, preserve the independently tested duel
        // policy: surviving a duel and preventing a base rush are different jobs.
        if (!this.room.settings.basesEnabled) return TacticalV4.prototype.combatMovementCost.call(this, bot, ...args);
        return this.advancedCombat(bot) ? super.combatMovementCost(bot, ...args) : 0;
    }
}

export class TacticalV5 extends withObjectiveDefense(AdaptiveObjectives) {}
