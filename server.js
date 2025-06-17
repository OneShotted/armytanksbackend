const express = require("express");
const http = require("http");
const path = require("path");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

let players = {};
let bullets = [];

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on("newPlayer", (data) => {
    players[socket.id] = {
      id: socket.id,
      username: data.username,
      tankType: data.tankType,
      x: 500,
      y: 500,
      angle: 0,
      health: 100,
      maxHealth: 100
    };
  });

  socket.on("playerMove", (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].angle = data.angle;
    }
  });

  socket.on("shoot", (bulletData) => {
    bullets.push({
      ...bulletData,
      shooterId: socket.id
    });
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
  });
});

setInterval(() => {
  // Update bullet positions
  bullets.forEach((b) => {
    b.x += Math.cos(b.angle) * b.speed;
    b.y += Math.sin(b.angle) * b.speed;
  });

  // Handle collisions
  bullets = bullets.filter((bullet) => {
    const hit = Object.values(players).some((player) => {
      if (player.id === bullet.shooterId) return false;
      const dx = player.x - bullet.x;
      const dy = player.y - bullet.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 20) {
        player.health -= 10;
        return true;
      }
      return false;
    });
    return !hit && bullet.x >= 0 && bullet.x <= 2000 && bullet.y >= 0 && bullet.y <= 2000;
  });

  io.emit("state", { players, bullets });
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
