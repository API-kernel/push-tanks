import { SPAWN_COLUMNS, TILE_SIZE } from '../config.js';
import { DIRECTIONS, distance, liveTanks, shotAt } from './geometry.js';
import { terrainCost } from './navigation-v2.js';

// Choose only among the game's existing spawn points. Waiting for a free point
// prevents allied piles; this does not change spawn timing, tank type or stats.
export function chooseTacticalSpawn(room, teamId, busy, random) {
    const team = room.teamManager.getTeam(teamId);
    if (!team) return null;
    const points = SPAWN_COLUMNS.map(col => ({ x: col * TILE_SIZE, y: team.spawnPixelY }));
    const available = points.filter(p => !busy.some(t => !t.isDead && Math.abs(t.x - p.x) < 16 && Math.abs(t.y - p.y) < 16));
    if (!available.length) return null;
    const roll = random(); // one draw per successful spawn, none while blocked
    const foes = liveTanks(room).filter(t => t.team !== teamId);
    const home = room.teamManager.getAllBases().find(b => b.team === teamId && !b.isDead);
    const threats = home ? foes.filter(t => distance(t, home) < 96) : [];
    const forward = DIRECTIONS[team.direction];
    let best = null, bestScore = Infinity;
    const offset = Math.floor(roll * available.length);
    for (let index = 0; index < available.length; index++) {
        const p = available[(index + offset) % available.length];
        const exit = { x: p.x + forward[0] * 16, y: p.y + forward[1] * 16 };
        const cost = terrainCost(room, { team: teamId, level: 1 }, exit);
        let score = Number.isFinite(cost) ? cost * 2 : 80;
        if (threats.length) score += Math.min(...threats.map(t => distance(p, t))) / 4;
        for (const target of foes) {
            // Public physical fields only; never inspect future movement inputs.
            const shooter = { x: target.x, y: target.y, team: target.team, id: target.id,
                direction: target.direction, level: target.level || 1, bulletSpeed: target.bulletSpeed };
            const shot = shotAt(room, shooter, target.direction, { ...p, width: 16, height: 16 });
            if (shot && !shot.breach) score += 80 - Math.min(50, shot.distance / 4);
        }
        for (const ally of busy) {
            if (ally.team === teamId && !ally.isDead) score += Math.max(0, 48 - distance(p, ally)) / 3;
        }
        if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
}
