import { TacticalV5 } from './tactical-v5.js';
import { withFireAvailability } from './fire-availability-v6.js';
import { withSafeYieldV6 } from './safe-yield-v6.js';

// Keep the V5 decisions and fix only committed yielding and fire availability.
export class TacticalV6 extends withSafeYieldV6(withFireAvailability(TacticalV5)) {}
