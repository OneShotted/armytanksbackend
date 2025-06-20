const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

app.use(cors());
app.get('/', (req, res) => res.send('Petal.io Server is running'));

const PORT = process.env.PORT || 3000;

const players = {};
const enemies = [];

function createEnemy() {
    return {
        id: Date.now() + Math.random(),
        x: Math.random() * 2000,
        y: Math.random() * 2000,
        hp: 3,
        drop: 'basic'
    };
}

// Spawn enemies periodically
setInterval(() => {
    if (enemies.length < 10) {
        enemies.push(createEnemy());
        io.emit('enemies', enemies);
    }
}, 5000);

io.on('connection', socket => {
    console.log('New player connected:', socket.id);

    // Create player with hotbar + inventory
    players[socket.id] = {
        id: socket.id,
        x: 500,
        y: 500,
        petals: ['basic', 'basic', 'basic', 'basic', 'basic'], // hotbar
        inventory: [] // collected petals go here
    };

    socket.emit('init', {
        id: socket.id,
        players,
        enemies
    });

    io.emit('players', players);

    // Handle movement
    socket.on('move', data => {
        const player = players[socket.id];
        if (player) {
            player.x += data.dx;
            player.y += data.dy;
            io.emit('players', players);
        }
    });

    // Handle collecting enemy petals
    socket.on('collect', enemyId => {
        const enemy = enemies.find(e => e.id === enemyId);
        const player = players[socket.id];
        if (enemy && player) {
            player.inventory.push(enemy.drop); // Add to inventory, not hotbar
            enemies.splice(enemies.indexOf(enemy), 1);
            io.emit('enemies', enemies);
        }
    });

    // Handle disconnects
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete players[socket.id];
        io.emit('players', players);
    });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

