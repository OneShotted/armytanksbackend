// server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'https://armytanks.netlify.app',
  'http://localhost:3000',
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
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
      if (allowedOrigins.includes(origin)) {
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
const TANK_RADIUS = 20;

// Remove all old walls, create spawn enclosure
// Square enclosure around spawn with 4 entrances (gaps)
const spawnX = ARENA_WIDTH / 2;
const spawnY = ARENA_HEIGHT / 2;
const ENCLOSURE_SIZE = 600;  // width and height of the square enclosure
const WALL_THICKNESS = 40;
const ENTRANCE_SIZE = 100; // size of each gap

const walls = [
  // Top wall: left segment before gap
  {
    x: spawnX - ENCLOSURE_SIZE / 2,
    y: spawnY - ENCLOSURE_SIZE / 2,
    width: (ENCLOSURE_SIZE - ENTRANCE_SIZE) / 2,
    height: WALL_THICKNESS
  },
  // Top wall: right segment after gap
  {
    x: spawnX + ENTRANCE_SIZE / 2,
    y: spawnY - ENCLOSURE_SIZE / 2,
    width: (ENCLOSURE_SIZE - ENTRANCE_SIZE) / 2,
    height: WALL_THICKNESS
  },

  // Bottom wall: left segment before gap
  {
    x: spawnX - ENCLOSURE_SIZE / 2,
    y: spawnY + ENCLOSURE_SIZE / 2 - WALL_THICKNESS,
    width: (ENCLOSURE_SIZE - ENTRANCE_SIZE) / 2,
    height: WALL_THICKNESS
  },
  // Bottom wall: right segment after gap
  {
    x: spawnX + ENTRANCE_SIZE / 2,
    y: spawnY + ENCLOSURE_SIZE / 2 - WALL_THICKNESS,
    width: (ENCLOSURE_SIZE - ENTRANCE_SIZE) / 2,
    height: WALL_THICKNESS
  },

  // Left wall: top segment before gap
  {
    x: spawnX - ENCLOSURE_SIZE / 2,
    y: spawnY - ENCLOSURE_SIZE / 2 + WALL_THICKNESS,
    width: WALL_THICKNESS,
    height: (ENCLOSURE_SIZE - ENTRANCE_SIZE) / 2 - WALL_THICKNESS
  },
  // Left wall: bottom segment after gap
  {
    x: spawnX - ENCLOSURE_SIZE / 2,
    y: spawnY + ENTRANCE_SIZE / 2,
    width: WALL_THICKNESS,
    height: (ENCLOSURE_SIZE - ENTRANCE_SIZE) / 2 - WALL_THICKNESS
  },

  // Right wall: top segment before gap
  {
    x: spawnX + ENCLOSURE_SIZE / 2 - WALL_THICKNESS,
    y: spawnY - ENCLOSURE_SIZE / 2 + WALL_THICKNESS,
    width: WALL_THICKNESS,
    height: (ENCLOSURE_SIZE - ENTRANCE_SIZE) / 2 - WALL_THICKNESS
  },
  // Right wall: bottom segment after gap
  {
    x: spawnX + ENCLOSURE_SIZE / 2 - WALL_THICKNESS,
    y: spawnY + ENTRANCE_SIZE / 2,
    width: WALL_THICKNESS,
    height: (ENCLOSURE_SIZE - ENTRANCE_SIZE) / 2 - WALL_THICKNESS
  },
];

let players = {};
let bullets = [];

function circleRectCollision(cx, cy, radius, rx, ry, rw, rh) {
  let closestX = Math.max(rx, Math.min(cx, rx + rw));
  let closestY = Math.max(ry, Math.min(cy, ry + rh));
  let dx = cx - closestX;
  let dy = cy - closestY;
  return (dx * dx + dy * dy) < (radius * radius);
}

function lineRectCollision(x1, y1, x2, y2, rx, ry, rw, rh) {
  function lineLine(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (y4 - y3)*(x2 - x1) - (x4 - x3)*(y2 - y1);
    if (denom === 0) return false;
    const ua = ((x4 - x3)*(y1 - y3) - (y4 - y3)*(x1 - x3)) / denom;
    const ub = ((x2 - x1)*(y1 - y3) - (y2 - y1)*(x1 - x3)) / denom;
    return (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1);
  }

  if (
    lineLine(x1, y1, x2, y2, rx, ry, rx + rw, ry) ||
    lineLine(x1, y1, x2, y2, rx, ry, rx, ry + rh) ||
    lineLine(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh) ||
    lineLine(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh)
  ) {
    return true;
  }
  return false;
}

app.get('/', (req, res) => {
  res.send('BlockTanks.io Socket.io Server running');
});

io.on('connection', (socket) => {
  console.log('Player connected', socket.id);

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

    let newX = player.x;
    let newY = player.y;

    if (input.up) newY -= TANK_SPEED;
    if (input.down) newY += TANK_SPEED;
    if (input.left) newX -= TANK_SPEED;
    if (input.right) newX += TANK_SPEED;

    // Collision with walls (including spawn enclosure)
    let collision = false;
    for (const wall of walls) {
      if (circleRectCollision(newX, newY, TANK_RADIUS, wall.x, wall.y, wall.width, wall.height)) {
        collision = true;
        break;
      }
    }

    if (!collision) {
      player.x = Math.max(0, Math.min(ARENA_WIDTH, newX));
      player.y = Math.max(0, Math.min(ARENA_HEIGHT, newY));
    }
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

setInterval(() => {
  const now = Date.now();

  for (const id in players) {
    const p = players[id];

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
      } else if (p.tankType === 'shotgun') {
        speed = BULLET_SPEED * 0.5;
        radius = 10;
        damage = 40;
      }

      bullets.push({
        id: Math.random().toString(36).substr(2, 9),
        x: p.x,
        y: p.y,
        angle: p.angle,
        ownerId: id,
        speed,
        distanceTravelled: 0,
        maxDistance,
        damage,
        radius,
      });

      p.lastShotTime = now;
    }
  }

  bullets = bullets.filter(bullet => {
    const dx = Math.cos(bullet.angle) * bullet.speed;
    const dy = Math.sin(bullet.angle) * bullet.speed;

    const nextX = bullet.x + dx;
    const nextY = bullet.y + dy;

    for (const wall of walls) {
      if (lineRectCollision(bullet.x, bullet.y, nextX, nextY, wall.x, wall.y, wall.width, wall.height)) {
        return false;
      }
    }

    bullet.x = nextX;
    bullet.y = nextY;
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

      if (dist < TANK_RADIUS + (bullet.radius || 5)) {
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

