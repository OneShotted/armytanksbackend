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
const ARENA_WIDTH = 3200;
const ARENA_HEIGHT = 2400;

const SPAWN_SAFE_RADIUS = 150;

// Walls: x, y (top-left), width, height
let walls = [
  { x: 100, y: 100, width: 400, height: 20 },
  { x: 600, y: 300, width: 20, height: 400 },
  { x: 1500, y: 1500, width: 300, height: 30 },
  // add more walls as you want here
];

// Move walls away from spawn safe zone
function adjustWallsForSpawn() {
  const centerX = ARENA_WIDTH / 2;
  const centerY = ARENA_HEIGHT / 2;

  for (const wall of walls) {
    const wallCenterX = wall.x + wall.width / 2;
    const wallCenterY = wall.y + wall.height / 2;
    const distX = wallCenterX - centerX;
    const distY = wallCenterY - centerY;
    const dist = Math.sqrt(distX * distX + distY * distY);

    if (dist < SPAWN_SAFE_RADIUS + Math.max(wall.width, wall.height)) {
      const angle = Math.atan2(distY, distX);
      wall.x = centerX + Math.cos(angle) * (SPAWN_SAFE_RADIUS + 100) - wall.width / 2;
      wall.y = centerY + Math.sin(angle) * (SPAWN_SAFE_RADIUS + 100) - wall.height / 2;
    }
  }
}
adjustWallsForSpawn();

let players = {};
let bullets = [];

app.get('/', (req, res) => {
  res.send('BlockTanks.io Socket.io Server running');
});

// Simple rectangle collision detection helper
function rectsCollide(r1, r2) {
  return !(
    r2.x > r1.x + r1.width ||
    r2.x + r2.width < r1.x ||
    r2.y > r1.y + r1.height ||
    r2.y + r2.height < r1.y
  );
}

// Collision check for player with walls; returns true if colliding
function isCollidingWithWall(x, y, width, height) {
  const playerRect = { x, y, width, height };
  for (const wall of walls) {
    if (rectsCollide(playerRect, wall)) {
      return true;
    }
  }
  return false;
}

io.on('connection', (socket) => {
  console.log('Player connected', socket.id);

  // Player size for collision
  const PLAYER_SIZE = 40;

  // Spawn point safely outside walls (center)
  const spawnX = ARENA_WIDTH / 2;
  const spawnY = ARENA_HEIGHT / 2;

  players[socket.id] = {
    id: socket.id,
    username: 'Anonymous',
    x: spawnX,
    y: spawnY,
    angle: 0,
    health: 100,
    tankType: 'sniper',
    pressingUp: false,
    pressingDown: false,
    pressingLeft: false,
    pressingRight: false,
    shooting: false,
    lastShotTime: 0,
    size: PLAYER_SIZE,
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

  socket.on('respawn', () => {
    const player = players[socket.id];
    if (player) {
      player.health = 100;
      player.x = spawnX;
      player.y = spawnY;
      io.emit('playerUpdated', player);
    }
  });
});

// Game loop ~60 FPS
setInterval(() => {
  const now = Date.now();

  for (const id in players) {
    const p = players[id];

    let newX = p.x;
    let newY = p.y;

    if (p.pressingUp) newY -= TANK_SPEED;
    if (p.pressingDown) newY += TANK_SPEED;
    if (p.pressingLeft) newX -= TANK_SPEED;
    if (p.pressingRight) newX += TANK_SPEED;

    // Clamp inside arena
    newX = Math.max(0, Math.min(ARENA_WIDTH, newX));
    newY = Math.max(0, Math.min(ARENA_HEIGHT, newY));

    // Check collision with walls before applying new position
    const playerSize = p.size || 40;
    if (!isCollidingWithWall(newX - playerSize / 2, newY - playerSize / 2, playerSize, playerSize)) {
      p.x = newX;
      p.y = newY;
    }
    // else do not move if collision

    // Shooting cooldown and bullet creation
    if (p.shooting && now - p.lastShotTime > 300 && p.health > 0) {
      let speed = BULLET_SPEED;
      let maxDistance = 1000;
      let damage = 20;
      let radius = 5;

      if (p.tankType === 'sniper') {
        speed = BULLET_SPEED * 8;
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

      if (dist < 20 + (bullet.radius || 5)) {
        p.health -= bullet.damage;

        if (p.health <= 0) {
          p.health = 0;
          io.to(p.id).emit('playerDied');
        }
        return false;
      }
    }
    return true;
  });

  io.emit('gameState', { players, bullets, walls });
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
