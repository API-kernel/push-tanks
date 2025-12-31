import { TILE_SIZE, SPAWN_COLUMNS, TEAMS_CONFIG } from './config.js';
import { BASE_WALLS, BLOCK_FULL } from './config.js';

export class TeamManager {
    constructor() {
        this.teams = {};
        this.basesEnabled = true;
        this.useConcreteLid = false; 

        TEAMS_CONFIG.forEach(cfg => {
            this.teams[cfg.id] = {
                ...cfg, 
                basePos: { 
                    x: cfg.baseXY.x * TILE_SIZE, 
                    y: cfg.baseXY.y * TILE_SIZE 
                },
                spawnPixelY: cfg.spawnY * TILE_SIZE,
                baseAlive: true,
                spawnTimer: 0,
                safeZone: cfg.direction === 'UP' 
                    ? { rMin: 22, rMax: 25, cMin: 10, cMax: 15 }
                    : { rMin: 0, rMax: 3, cMin: 10, cMax: 15 }
            };
        });
    }
    
    setConcreteLid(enabled) {
        this.useConcreteLid = enabled;
    }

    setBasesEnabled(enabled) {
        this.basesEnabled = enabled;
    }

    getTeam(teamId) { return this.teams[teamId]; }
    getTeams() { return Object.values(this.teams); }
    getMaxUnits(teamId) { return this.teams[teamId] ? this.teams[teamId].maxUnits : 0; }

    getAllBases() {
        if (!this.basesEnabled) return [];

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

    isInBaseZone(teamId, r, c) {
        if (!this.basesEnabled) return false;
        
        const team = this.teams[teamId];
        if (!team) return false;
        
        const z = team.safeZone;
        return (r >= z.rMin && r <= z.rMax && c >= z.cMin && c <= z.cMax);
    }

    destroyBase(teamId) {
        if (this.teams[teamId]) this.teams[teamId].baseAlive = false;
    }

    fortifyBase(teamId, isSteel, map) {
        const team = this.teams[teamId];
        if (!team || !team.baseAlive) return;

        const walls = BASE_WALLS[teamId];
        const baseType = isSteel ? 2 : 1; 

        walls.forEach(w => {
            if (map[w.r] && map[w.r][w.c] !== undefined) {
                
                let typeToSet = baseType;

                if (!isSteel && this.useConcreteLid) {
                    const isCenter = (w.c === 12 || w.c === 13);
                    
                    // Для Зеленых (1) ряд 23, для Красных (2) ряд 2
                    const isLidRow = (teamId === 1 && w.r === 23) || (teamId === 2 && w.r === 2);

                    if (isCenter && isLidRow) {
                        typeToSet = 2; // Принудительно Бетон
                    }
                }

                map[w.r][w.c] = {
                    type: typeToSet,
                    mask: BLOCK_FULL,
                    isBaseWall: true
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