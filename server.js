// server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);


const FRONTEND_URL = 'https://plorra.netlify.app';

app.use(cors({
  origin: FRONTEND_URL,
  methods: ['GET', 'POST']
}));

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST'],
  },
});

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3000;

const TANK_SPEED = 3;
const BULLET_SPEED = 7;
const ARENA_WIDTH = 800;
const ARENA_HEIGHT = 600;

let players = {};
let bullets = [];

app.get('/', (req, res) => {
  res.send('BlockTanks.io Socket.io Server running');
});

io.on('connection', (socket) => {
  console.log('Player connected', socket.id);

  // Initialize new player
  players[socket.id] = {
    id: socket.id,
    x: ARENA_WIDTH / 2,
    y: ARENA_HEIGHT / 2,
    angle: 0,
    health: 100,
    pressingUp: false,
    pressingDown: false,
    pressingLeft: false,
    pressingRight: false,
    shooting: false,
    lastShotTime: 0,
  };

  // Send current game state to new player
  socket.emit('init', { players, bullets });

  // Notify others of new player
  socket.broadcast.emit('newPlayer', players[socket.id]);

  socket.on('input', (input) => {
    const player = players[socket.id];
    if (!player) return;

    player.pressingUp = input.up;
    player.pressingDown = input.down;
    player.pressingLeft = input.left;
    player.pressingRight = input.right;
    player.angle = input.angle;
    player.shooting = input.shooting;
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected', socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

// Game loop at ~60 FPS
setInterval(() => {
  const now = Date.now();

  // Update players
  for (const id in players) {
    const p = players[id];

    if (p.pressingUp) p.y -= TANK_SPEED;
    if (p.pressingDown) p.y += TANK_SPEED;
    if (p.pressingLeft) p.x -= TANK_SPEED;
    if (p.pressingRight) p.x += TANK_SPEED;

    // Clamp inside arena
    p.x = Math.max(0, Math.min(ARENA_WIDTH, p.x));
    p.y = Math.max(0, Math.min(ARENA_HEIGHT, p.y));

    // Shooting cooldown
    if (p.shooting && now - p.lastShotTime > 300) {
      bullets.push({
        id: Math.random().toString(36).substr(2, 9),
        x: p.x,
        y: p.y,
        angle: p.angle,
        ownerId: id,
        speed: BULLET_SPEED,
      });
      p.lastShotTime = now;
    }
  }

  // Update bullets
  bullets = bullets.filter((bullet) => {
    bullet.x += Math.cos(bullet.angle) * bullet.speed;
    bullet.y += Math.sin(bullet.angle) * bullet.speed;

    // Remove bullets out of bounds
    if (
      bullet.x < 0 || bullet.x > ARENA_WIDTH ||
      bullet.y < 0 || bullet.y > ARENA_HEIGHT
    ) return false;

    // Check collisions
    for (const id in players) {
      if (id === bullet.ownerId) continue;
      const p = players[id];
      const dx = p.x - bullet.x;
      const dy = p.y - bullet.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 20) { // collision radius
        p.health -= 20;
        if (p.health <= 0) {
          p.health = 100;
          p.x = ARENA_WIDTH / 2;
          p.y = ARENA_HEIGHT / 2;
        }
        return false; // Remove bullet on hit
      }
    }
    return true;
  });

  io.emit('gameState', { players, bullets });
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

