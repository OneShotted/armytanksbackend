// server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Allowed frontend origins for CORS
const allowedOrigins = [
  'https://armytanks.netlify.app',
  'http://localhost:3000', // local dev
];

// CORS middleware for Express routes
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // allow non-browser clients like Postman
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS error: Origin not allowed'));
    }
  },
  methods: ['GET', 'POST']
}));

const io = new Server(server, {
  cors: {
    origin: function(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('CORS error: Origin not allowed'));
      }
    },
    methods: ['GET', 'POST'],
  }
});

const PORT = process.env.PORT || 3000;

const TANK_SPEED = 3;
const BULLET_SPEED = 7;
const ARENA_WIDTH = 3200;  // doubled from 800
const ARENA_HEIGHT = 2400; // doubled from 600

// Walls array — match client-side exactly
const walls = [
  { x: 600, y: 600, width: 200, height: 40 },
  { x: 1500, y: 1200, width: 300, height: 50 },
  { x: 2500, y: 1800, width: 100, height: 300 },
  // add more walls as needed
];

let players = {};
let bullets = [];

app.get('/', (req, res) => {
  res.send('BlockTanks.io Socket.io Server running');
});

io.on('connection', (socket) => {
  console.log('Player connected', socket.id);

  players[socket.id] = {
    id: socket.id,
    username: 'Anonymous',
    x: ARENA_WIDTH / 2,
    y: ARENA_HEIGHT / 2,
    angle: 0,
    health: 100,
    tankType: 'sniper', // default tank type
    pressingUp: false,
    pressingDown: false,
    pressingLeft: false,
    pressingRight: false,
    shooting: false,
    lastShotTime: 0,
  };

  socket.on('setUsername', (name) => {
    if (players[socket.id]) {
      players[socket.id].username = String(name).substring(0, 15);
      io.emit('playerUpdated', players[socket.id]);
    }
  });

  socket.on('setTankType', (tankType) => {
    if (players[socket.id]) {
      const validTypes = ['sniper', 'minigun', 'shotgun'];
      players[socket.id].tankType = validTypes.includes(tankType) ? tankType : 'sniper';
      io.emit('playerUpdated', players[socket.id]);
    }
  });

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

  // Respawn event: reset health and set random position
  socket.on('respawn', () => {
    const player = players[socket.id];
    if (player) {
      player.health = 100;
      const margin = 50;
      player.x = Math.random() * (ARENA_WIDTH - 2 * margin) + margin;
      player.y = Math.random() * (ARENA_HEIGHT - 2 * margin) + margin;
      io.emit('playerUpdated', player);
    }
  });
});

// Helper: check if two rectangles overlap
function rectsOverlap(r1, r2) {
  return !(
    r1.x + r1.width < r2.x ||
    r1.x > r2.x + r2.width ||
    r1.y + r1.height < r2.y ||
    r1.y > r2.y + r2.height
  );
}

// Player size approximation (match your drawTank sizes)
const PLAYER_WIDTH = 30;
const PLAYER_HEIGHT = 20;

// Game loop ~60 FPS
setInterval(() => {
  const now = Date.now();

  for (const id in players) {
    const p = players[id];

    // Calculate proposed new position based on input
    let newX = p.x;
    let newY = p.y;

    if (p.pressingUp) newY -= TANK_SPEED;
    if (p.pressingDown) newY += TANK_SPEED;
    if (p.pressingLeft) newX -= TANK_SPEED;
    if (p.pressingRight) newX += TANK_SPEED;

    // Player rectangle at new position
    const playerRect = {
      x: newX - PLAYER_WIDTH / 2,
      y: newY - PLAYER_HEIGHT / 2,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
    };

    // Check collision with walls
    let collision = false;
    for (const wall of walls) {
      if (rectsOverlap(playerRect, wall)) {
        collision = true;
        break;
      }
    }

    // If no collision, update position
    if (!collision) {
      p.x = newX;
      p.y = newY;
    }

    // Clamp inside arena bounds
    p.x = Math.max(PLAYER_WIDTH / 2, Math.min(ARENA_WIDTH - PLAYER_WIDTH / 2, p.x));
    p.y = Math.max(PLAYER_HEIGHT / 2, Math.min(ARENA_HEIGHT - PLAYER_HEIGHT / 2, p.y));

    // Shooting cooldown and bullet creation
    if (p.shooting && now - p.lastShotTime > 300 && p.health > 0) {
      // Default bullet params
      let speed = BULLET_SPEED;
      let maxDistance = 1000; // normal range
      let damage = 20;
      let radius = 5;

      if (p.tankType === 'sniper') {
        speed = BULLET_SPEED * 8; // extremely fast
        maxDistance = 2000;
      } else if (p.tankType === 'minigun') {
        speed = BULLET_SPEED * 1.5;
        maxDistance = 1000;
      } else if (p.tankType === 'shotgun') {
        speed = BULLET_SPEED * 0.5;
        radius = 10;
        damage = 40;
        maxDistance = 1000;
      }

      bullets.push({
        id: Math.random().toString(36).substr(2, 9),
        x: p.x,
        y: p.y,
        angle: p.angle,
        ownerId: id,
        speed: speed,
        distanceTravelled: 0,
        maxDistance: maxDistance,
        damage: damage,
        radius: radius,
      });

      p.lastShotTime = now;
    }
  }

  bullets = bullets.filter((bullet) => {
    const dx = Math.cos(bullet.angle) * bullet.speed;
    const dy = Math.sin(bullet.angle) * bullet.speed;

    bullet.x += dx;
    bullet.y += dy;
    bullet.distanceTravelled += Math.sqrt(dx * dx + dy * dy);

     if (
      bullet.distanceTravelled > bullet.maxDistance ||
      bullet.x < 0 || bullet.x > ARENA_WIDTH ||
      bullet.y < 0 || bullet.y > ARENA_HEIGHT
    ) return false;

    for (const id in players) {
      if (id === bullet.ownerId) continue;
      const p = players[id];
      const distX = p.x - bullet.x;
      const distY = p.y - bullet.y;
      const dist = Math.sqrt(distX * distX + distY * distY);

      if (dist < 20 + (bullet.radius || 5)) { // tank radius + bullet radius collision
        p.health -= bullet.damage;

        if (p.health <= 0) {
          p.health = 0;

          // Notify only the player who died
          io.to(p.id).emit('playerDied');
        }
        return false; // remove bullet
      }
    }
    return true;
  });

  io.emit('gameState', { players, bullets });
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
