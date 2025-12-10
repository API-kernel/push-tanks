import { TILE_SIZE, SPAWN_COLUMNS, TEAMS_CONFIG } from '../shared/config.js';
import { level1 } from './level.js';
import { BASE_WALLS } from '../shared/config.js';

class TeamManager {
    constructor() {
        this.teams = {};
        TEAMS_CONFIG.forEach(cfg => {
            this.teams[cfg.id] = {
                ...cfg, 
                basePos: { 
                    x: cfg.baseXY.x * TILE_SIZE, 
                    y: cfg.baseXY.y * TILE_SIZE 
                },
                spawnPixelY: cfg.spawnY * TILE_SIZE,
                baseAlive: true,
                spawnTimer: 0
            };
        });
    }

    getTeam(teamId) { return this.teams[teamId]; }
    getTeams() { return Object.values(this.teams); }
    getMaxUnits(teamId) { return this.teams[teamId] ? this.teams[teamId].maxUnits : 0; }

    getAllBases() {
        return Object.values(this.teams).map(t => ({
            team: t.id,
            x: t.basePos.x,
            y: t.basePos.y,
            width: TILE_SIZE,
            height: TILE_SIZE,
            isDead: !t.baseAlive,
            name: t.name
        }));
    }

    destroyBase(teamId) {
        if (this.teams[teamId]) this.teams[teamId].baseAlive = false;
    }

    fortifyBase(teamId, isSteel) {
        const team = this.teams[teamId];
        if (!team || !team.baseAlive) return;

        const walls = BASE_WALLS[teamId];
        const newType = isSteel ? 2 : 1; 

        walls.forEach(w => {
            if (level1[w.r] && level1[w.r][w.c] !== undefined) {
                level1[w.r][w.c] = {
                    type: newType,
                    mask: w.mask 
                };
            }
        });
    }

    getSpawnPoint(teamId, busyEntities = []) {
        const team = this.teams[teamId];
        if (!team) return null;

        const possiblePoints = SPAWN_COLUMNS.map(col => ({
            x: col * TILE_SIZE,
            y: team.spawnPixelY
        }));

        const freePoints = possiblePoints.filter(point => {
            const isOccupied = busyEntities.some(e => 
                Math.abs(e.x - point.x) < TILE_SIZE && 
                Math.abs(e.y - point.y) < TILE_SIZE
            );
            return !isOccupied;
        });

        if (freePoints.length > 0) {
            return freePoints[Math.floor(Math.random() * freePoints.length)];
        }
        return possiblePoints[Math.floor(Math.random() * possiblePoints.length)];
    }
}

export const teamManager = new TeamManager();