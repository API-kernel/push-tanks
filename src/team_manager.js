import { TILE_SIZE, SPAWN_COLUMNS, TEAMS_CONFIG } from './config.js';

class TeamManager {
    constructor() {
        this.teams = {};

        // Строим состояние
        TEAMS_CONFIG.forEach(cfg => {
            this.teams[cfg.id] = {
                ...cfg, // name, maxUnits, id
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

    // Возвращает массив ВСЕХ команд (объектов состояния)
    getTeams() {
        return Object.values(this.teams);
    }

    // Для конкретной проверки
    getTeam(id) {
        return this.teams[id];
    }

    // Убить базу
    destroyBase(id) {
        if (this.teams[id]) this.teams[id].baseAlive = false;
    }

    // Поиск точки спавна
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