import { MAP_WIDTH, MAP_HEIGHT } from '../config.js';
import { updateTankMovement } from '../tank.js';
import { createBullet } from '../bullet.js';

// Frozen baseline: the original random movement and firing policy.
// Spawning, physics and bonus rules are shared with every policy.
export function updateLegacyBot(room, enemy) {
    const random = room.teamRandom[enemy.team];
    const changeDirection = () => {
        const r = random();
        const forward = enemy.team === 2 ? 'DOWN' : 'UP';
        enemy.direction = r < .25 ? forward : r < .5
            ? (forward === 'UP' ? 'DOWN' : 'UP') : r < .75 ? 'LEFT' : 'RIGHT';
        enemy.x = Math.round(enemy.x);
        enemy.y = Math.round(enemy.y);
    };
    if (!enemy.isMoving || random() < .005) changeDirection();
    if (!updateTankMovement(enemy, enemy.direction, MAP_WIDTH, MAP_HEIGHT,
        room.map, room.checkGlobalCollision.bind(room)) && random() < .5) changeDirection();
    if (enemy.bulletTimer <= 0) {
        room.bullets.push(createBullet(enemy, enemy.bulletSpeed));
        room.bulletEvents.push({ type: 'ENEMY_FIRE', ownerId: enemy.id, team: enemy.team });
        enemy.bulletTimer = enemy.bulletCooldownMax * (1 + random() / 2);
    }
}
