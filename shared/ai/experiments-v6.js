import { TacticalV5 } from './tactical-v5.js';
import { TacticalV6 } from './tactical-v6.js';
import { withSafeYieldV6 } from './safe-yield-v6.js';
import { withFireAvailability } from './fire-availability-v6.js';
import { withTeamV6 } from './team-v6.js';
import { withObjectiveTimingV6 } from './objective-timing-v6.js';
import { withResourceV6 } from './resource-v6.js';
import { withTickPathV6 } from './planner-v6.js';

export const V6_EXPERIMENT_POLICIES = Object.freeze({
    'experiment-v6-yield': withSafeYieldV6(TacticalV5),
    'experiment-v6-capacity': withFireAvailability(TacticalV5, { capacity: true, clock: false }),
    'experiment-v6-clock': withFireAvailability(TacticalV5, { capacity: false, clock: true }),
    'experiment-v6-crossfire': withTeamV6(TacticalV6),
    'experiment-v6-objective': withObjectiveTimingV6(TacticalV6),
    'experiment-v6-resource': withResourceV6(TacticalV6),
    'experiment-v6-path': withTickPathV6(TacticalV6),
    'experiment-v6-team-objective': withTeamV6(withObjectiveTimingV6(TacticalV6)),
    'experiment-v6-strategy': withTeamV6(withObjectiveTimingV6(withResourceV6(TacticalV6))),
    'experiment-v6-full': withTickPathV6(withTeamV6(withObjectiveTimingV6(withResourceV6(TacticalV6)))),
});
