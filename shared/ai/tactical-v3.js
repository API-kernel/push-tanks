import { TacticalNavigation } from './navigation-controller.js';
import { TacticalCombat } from './combat-v3.js';
import { TacticalCommander } from './commander-v3.js';

// Compose independently tested experiments while keeping all released opponents frozen.
export class TacticalV3 extends TacticalNavigation {
    reset() {
        TacticalCombat.prototype.reset.call(this);
        this.collectors = new Map();
    }

    prepare() {
        TacticalCombat.prototype.prepare.call(this);
        // Observe motion once per physics tick; react to strategic threats more frequently.
        if (this.tick % 8 === 0) this.assignTasks();
    }

    assignTasks() { return TacticalCommander.prototype.assignTasks.call(this); }
    movePreview(...args) { return TacticalCombat.prototype.movePreview.apply(this, args); }
    chooseShot(...args) { return TacticalCombat.prototype.chooseShot.apply(this, args); }
    incoming(...args) { return TacticalCombat.prototype.incoming.apply(this, args); }
    trajectoryRisk(...args) { return TacticalCombat.prototype.trajectoryRisk.apply(this, args); }
    movementRisk(...args) { return TacticalCombat.prototype.movementRisk.apply(this, args); }
    combatMovementCost(...args) { return TacticalCombat.prototype.combatMovementCost.apply(this, args); }
}
