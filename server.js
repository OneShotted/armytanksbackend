const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const ARENA_WIDTH = 3200;
const ARENA_HEIGHT = 2400;

const TANK_TYPES = {
  sniper: { speed: 3, size: 30, health: 100, damage: 25, fireRate: 1000 },
  minigun: { speed: 4, size: 30, health: 120, damage: 10, fireRate: 200 },
  shotgun: { speed: 2.5, size: 35, health: 150, damage: 40, fireRate: 1500 },
  default: { speed: 3.5, size: 30, health: 100, damage: 15, fireRate: 500 }
};

let players = {};
let bullets = [];
let walls = []; // You can populate walls here

function createNewPlayer(id, username, tankType) {
  const type = TANK_TYPES[tankType] || TANK_TYPES.default;
  return {
    id,
    username,
    tankType,
    x: Math.random() * ARENA_WIDTH,
    y: Math.random() * ARENA_HEIGHT,
    angle: 0,
    health: type.health,
    speed: type.speed,
    size: type.size,
    damage: type.damage,
    fireRate: type.fireRate,
    lastShot: 0,
  };
}

function updatePlayer(player, input, dt) {
  // Validate input and update position and angle
  if (player.health <= 0) return;

  // Movement
  let dx = 0, dy = 0;
  if (input.up) dy -= 1;
  if (input.down) dy += 1;
  if (input.left) dx -= 1;
  if (input.right) dx += 1;

  if (dx !== 0 || dy !== 0) {
    const length = Math.sqrt(dx*dx + dy*dy);
    dx /= length;
    dy /= length;
    player.x += dx * player.speed * dt;
    player.y += dy * player.speed * dt;

    // Clamp inside arena
    player.x = Math.max(0, Math.min(ARENA_WIDTH, player.x));
    player.y = Math.max(0, Math.min(ARENA_HEIGHT, player.y));
  }

  // Update angle
  player.angle = input.angle;

  // Shooting
  if (input.shooting) {
    const now = Date.now();
    if (now - player.lastShot > player.fireRate) {
      player.lastShot = now;
      spawnBullet(player);
    }
  }
}

function spawnBullet(player) {
  // Spawn bullet at player's position heading player.angle
  bullets.push({
    id: Date.now() + Math.random(),
    x: player.x + Math.cos(player.angle) * player.size,
    y: player.y + Math.sin(player.angle) * player.size,
    angle: player.angle,
    speed: 10,
    ownerId: player.id,
    radius: 5,
  });
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += Math.cos(b.angle) * b.speed * dt;
    b.y += Math.sin(b.angle) * b.speed * dt;

    // Remove bullets outside arena
    if (b.x < 0 || b.x > ARENA_WIDTH || b.y < 0 || b.y > ARENA_HEIGHT) {
      bullets.splice(i, 1);
      continue;
    }

    // Collision with players
    for (const id in players) {
      const p = players[id];
      if (p.id !== b.ownerId && p.health > 0) {
        const distSq = (p.x - b.x) ** 2 + (p.y - b.y) ** 2;
        if (distSq < (p.size / 2 + b.radius) ** 2) {
          // Hit
          p.health -= players[b.ownerId]?.damage || 10; // fallback damage if owner missing
          if (p.health < 0) p.health = 0;
          bullets.splice(i, 1);
          break;
        }
      }
    }
  }
}

function gameLoop() {
  const now = Date.now();
  let lastTime = now;
  setInterval(() => {
    const currentTime = Date.now();
    const dt = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    // Update all players (input saved per player)
    for (const id in players) {
      const player = players[id];
      if (player.input) {
        updatePlayer(player, player.input, dt);
      }
    }

    // Update bullets
    updateBullets(dt);

    // Broadcast game state
    io.emit('gameState', {
      players,
      bullets,
      walls,
    });
  }, 1000 / 60);
}

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on('setUsername', (username) => {
    if (players[socket.id]) {
      players[socket.id].username = username;
    }
  });

  socket.on('setTankType', (tankType) => {
    if (!players[socket.id]) {
      players[socket.id] = createNewPlayer(socket.id, 'Anonymous', tankType);
    } else {
      players[socket.id].tankType = tankType;
    }
  });

  socket.on('input', (input) => {
    if (players[socket.id]) {
      // Validate input here if needed
      players[socket.id].input = input;
    }
  });

  socket.on('chatMessage', ({ username, message }) => {
    io.emit('chatMessage', { username, message });
  });

  socket.on('respawn', () => {
    const p = players[socket.id];
    if (p) {
      p.health = TANK_TYPES[p.tankType]?.health || 100;
      p.x = Math.random() * ARENA_WIDTH;
      p.y = Math.random() * ARENA_HEIGHT;
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

gameLoop();

