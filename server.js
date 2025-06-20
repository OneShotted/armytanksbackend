const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

app.use(cors());
app.get('/', (req, res) => res.send('Petal.io Server is running'));

const PORT = process.env.PORT || 3000;

const players = {};
const enemies = [];
const petalDrops = [];

function createEnemy() {
    return {
        id: 'e' + Date.now() + Math.random(),
        x: Math.random() * 2000,
        y: Math.random() * 2000,
        hp: 5,
        drop: {
            id: 'p' + Date.now(),
            type: 'basic',
            hp: 3,
            damage: 1
        }
    };
}

setInterval(() => {
    if (enemies.length < 10) {
        enemies.push(createEnemy());
        io.emit('enemies', enemies);
    }
}, 5000);

io.on('connection', socket => {
    console.log('New player:', socket.id);

    players[socket.id] = {
        id: socket.id,
        x: 500,
        y: 500,
        petals: Array.from({ length: 5 }).map((_, i) => ({
            id: 'p' + i,
            type: 'basic',
            hp: 3,
            damage: 1
        })),
        inventory: []
    };

    socket.emit('init', {
        id: socket.id,
        players,
        enemies,
        drops: petalDrops
    });

    io.emit('players', players);

    socket.on('move', data => {
        const player = players[socket.id];
        if (player) {
            player.x += data.dx;
            player.y += data.dy;

            // Check petal drops
            for (let i = petalDrops.length - 1; i >= 0; i--) {
                const drop = petalDrops[i];
                const dist = Math.hypot(player.x - drop.x, player.y - drop.y);
                if (dist < 30) {
                    player.inventory.push(drop.petal);
                    petalDrops.splice(i, 1);
                }
            }

            io.emit('players', players);
            io.emit('drops', petalDrops);
        }
    });

    socket.on('petalAttack', ({ petalId, x, y }) => {
        enemies.forEach((enemy, i) => {
            const dist = Math.hypot(enemy.x - x, enemy.y - y);
            if (dist < 20) {
                enemy.hp -= 1;
                if (enemy.hp <= 0) {
                    petalDrops.push({
                        x: enemy.x,
                        y: enemy.y,
                        petal: enemy.drop
                    });
                    enemies.splice(i, 1);
                }
                io.emit('enemies', enemies);
                io.emit('drops', petalDrops);
            }
        });
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('players', players);
    });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
