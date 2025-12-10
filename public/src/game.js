console.log("Загрузка game.js (CLIENT)...");

import { InputHandler } from './input.js';
import { drawHUD } from './ui.js';
import { audio } from './audio.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT, MAP_WIDTH, MAP_HEIGHT, PADDING } from '../shared/config.js'; 
import { drawMapLayers, drawForest, drawBullets, drawEnemies, drawPlayers, drawExplosions, drawBases, drawBonus, updateExplosions, createExplosion, EXPLOSION_SMALL, EXPLOSION_BIG } from './renderer.js';

const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

const game = {
    sprites: new Image(),
    isLoaded: false,
    input: new InputHandler()
};

let serverState = {
    players: {},
    enemies: [],
    bullets: [],
    map: null,
    bases: [],
    bonus: null,
    isGameOver: false
};

// ... (код загрузки спрайтов и socket.on connect/map_init тот же) ...
game.sprites.onload = () => { game.isLoaded = true; requestAnimationFrame(loop); };
game.sprites.src = './assets/sprites.png';

let lastBonusId = null;

socket.on('state', (state) => {
    // 1. Обновление стейта
    serverState.players = state.players;
    serverState.enemies = state.enemies;
    serverState.bullets = state.bullets;
    serverState.bases = state.bases;
    serverState.isGameOver = state.isGameOver;
    if (state.map) serverState.map = state.map;

    // 2. Звук Бонуса
    if (state.bonus && state.bonus.id !== lastBonusId) {
        audio.play('bonus_appear');
        lastBonusId = state.bonus.id;
    }
    if (!state.bonus && lastBonusId) {
        audio.play('bonus_take');
        lastBonusId = null;
    }
    serverState.bonus = state.bonus;

    // 3. События (Взрывы и Звуки)
    if (state.events && state.events.length > 0) {
        state.events.forEach(e => {
            if (e.type === 'WALL_HIT') {
                createExplosion(e.x, e.y, EXPLOSION_SMALL);
                audio.play('miss_hit');
            }
            else if (e.type === 'SHIELD_HIT') {
                createExplosion(e.x, e.y, EXPLOSION_SMALL);
                audio.play('brick_hit');
            }
            else if (e.type === 'HIT') {
                createExplosion(e.x, e.y, EXPLOSION_SMALL);
                if (e.isSteel) audio.play('concrete_hit');
                else audio.play('brick_hit');
            }
            else if (e.type === 'TANK_EXPLODE') {
                createExplosion(e.x, e.y, EXPLOSION_BIG);
                // Как узнать, кто умер, по координатам сложно.
                // Проще играть дефолтный взрыв или сервер должен слать 'explosion_bot'/'explosion_player' в типе события.
                // Пока общий:
                audio.play('explosion');
            }
            else if (e.type === 'BASE_DESTROY') {
                createExplosion(e.x, e.y, EXPLOSION_BIG);
                audio.play('base_crash');
                audio.play('game_over'); // Можно тут
            }
            else if (e.type === 'ARMOR_HIT') {
                createExplosion(e.x, e.y, EXPLOSION_SMALL);
                audio.play('armor_hit');
            }
        });
    }
});

function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

function update() {
    // Input
    const input = {
        up: game.input.keys['KeyW'] || game.input.keys['ArrowUp'],
        down: game.input.keys['KeyS'] || game.input.keys['ArrowDown'],
        left: game.input.keys['KeyA'] || game.input.keys['ArrowLeft'],
        right: game.input.keys['KeyD'] || game.input.keys['ArrowRight'],
        fire: game.input.keys['Space'] || game.input.keys['Enter'],
        cheat0: game.input.keys['Digit0']
    };
    socket.emit('input', input);

    updateExplosions(); // Анимация
}

function draw() {
    // 1. Фон
    ctx.fillStyle = '#636363';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!game.isLoaded || !serverState.map) {
        ctx.fillStyle = 'white';
        ctx.fillText("Connecting...", 100, 100);
        return;
    }

    ctx.save();
    ctx.translate(PADDING, PADDING);

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    // 2. Игровое поле (Через Renderer)
    drawMapLayers(ctx, game.sprites, serverState.map, Date.now()); 
    drawBases(ctx, game.sprites, serverState.bases); // <--- Новая функция в renderer
    
    drawBonus(ctx, game.sprites, serverState.bonus); // <--- Новая функция

    drawBullets(ctx, game.sprites, serverState.bullets);
    drawEnemies(ctx, game.sprites, serverState.enemies);
    drawPlayers(ctx, game.sprites, serverState.players);
    drawExplosions(ctx, game.sprites);

    if (typeof drawForest === 'function') drawForest(ctx, game.sprites, serverState.map); 

    ctx.restore();

    // 3. HUD
    // Передаем массив игроков (преобразуем из объекта)
    drawHUD(ctx, game.sprites, serverState.players);

    // 4. UI Game Over
    if (serverState.isGameOver) {
        ctx.save();
        ctx.translate(PADDING, PADDING); // Чтобы координаты совпадали с полем
        ctx.fillStyle = 'red';
        ctx.font = 'bold 20px Courier New';
        ctx.textAlign = 'center';
        // Центр ПОЛЯ, а не экрана
        ctx.fillText("GAME OVER", MAP_WIDTH / 2, MAP_HEIGHT / 2);
        ctx.restore();
    }
}