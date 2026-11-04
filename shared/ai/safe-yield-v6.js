// A traffic manoeuvre is a preference, not a promise to drive into a new shell.
// Keep V5's traffic and screen decisions, but let its normal dodge search run
// when an existing projectile makes the committed escape unsafe.
export function withSafeYieldV6(Base) {
    return class SafeYieldV6 extends Base {
        reset() { super.reset(); this.yieldInterruptions = 0; }

        update(bot) {
            const state = this.memory.get(bot.id);
            if (state && this.tick < state.escapeUntil && state.escapeDirection) {
                const bullets = this.incoming(bot).filter(bullet => !bullet.predicted);
                if (bullets.length && this.movementRisk(bot, state.escapeDirection, bullets) > 0) {
                    state.escapeUntil = this.tick;
                    state.escapeDirection = null;
                    state.stuck = 0;
                    state.planTick = -100;
                    this.yieldInterruptions++;
                }
            }
            return super.update(bot);
        }
    };
}
