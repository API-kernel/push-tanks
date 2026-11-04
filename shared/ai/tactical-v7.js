import { TacticalV6 } from './tactical-v6.js';
import { withResourceHealingV6 } from './resource-healing-v6.js';
import { withObjectiveTimingV6 } from './objective-timing-v6.js';

// Release candidate: preserve the V6 physical fixes and ordinary combat, add
// only independently checked repair collection and timed base interception.
export class TacticalV7 extends withObjectiveTimingV6(withResourceHealingV6(TacticalV6)) {}
