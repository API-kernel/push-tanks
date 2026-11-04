import { TacticalV2 } from './tactical-v2.js';
import { TacticalV3 } from './tactical-v3.js';
import { TacticalCombat } from './combat-v3.js';
import { TacticalNavigation } from './navigation-controller.js';
import { TacticalCommander } from './commander-v3.js';

class NavigationCombat extends TacticalV3 {
    assignTasks() { return TacticalV2.prototype.assignTasks.call(this); }
}
class NoMovementCost extends TacticalV3 {
    combatMovementCost() { return 0; }
}
class LegacyDanger extends TacticalV3 {
    incoming(...args) { return TacticalV2.prototype.incoming.apply(this, args); }
    movementRisk(...args) { return TacticalV2.prototype.movementRisk.apply(this, args); }
}
class CombatCommander extends TacticalCombat {
    reset() { super.reset(); this.collectors = new Map(); }
    prepare() { super.prepare(); if (this.tick % 8 === 0) this.assignTasks(); }
    assignTasks() { return TacticalCommander.prototype.assignTasks.call(this); }
}
class NavigationCommander extends TacticalNavigation {
    reset() { super.reset(); this.collectors = new Map(); }
    prepare() { super.prepare(); if (this.tick % 8 === 0) this.assignTasks(); }
    assignTasks() { return TacticalCommander.prototype.assignTasks.call(this); }
}

// Laboratory policies are available to tournaments, not exposed in the game lobby.
export const EXPERIMENT_POLICIES = Object.freeze({
    'experiment-navigation': TacticalNavigation,
    'experiment-combat': TacticalCombat,
    'experiment-nav-combat': NavigationCombat,
    'experiment-nav-commander': NavigationCommander,
    'experiment-combat-commander': CombatCommander,
    'experiment-no-movement-cost': NoMovementCost,
    'experiment-legacy-danger': LegacyDanger
});
