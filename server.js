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

function getRandomPetal() {
    const types = ['basic', 'rock'];
    const type = types[Math.floor(Math.random() * types.length)];

    const baseStats = {
        basic: { hp: 3, damage: 1 },
        rock: { hp: 6, damage: 0.5 }
    };

    return {
        id: 'p' + Date.now() + Math.random(),
        type,
        hp: baseStats[type].hp,
        damage: baseStats[type].damage,
        isReloading: false
    };
}

function createEnemy() {
    return {
        id: 'e' + Date.now() + Math.random(),
        x: Math.random() * 2000,
        y: Math.random() * 2000,
        hp: 5,
        drop: getRandomPetal()
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
        petals: Array.from({ length: 5 }).map(() => getRandomPetal()),
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

            // Pickup petals
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
        const player = players[socket.id];
        if (!player) return;

        const petal = player.petals.find(p => p.id === petalId);
        if (!petal || petal.isReloading || petal.hp <= 0) return;

        enemies.forEach((enemy, i) => {
            const dist = Math.hypot(enemy.x - x, enemy.y - y);
            if (dist < 20) {
                enemy.hp -= petal.damage;
                petal.hp -= 1;

                if (petal.hp <= 0) {
                    petal.isReloading = true;
                    setTimeout(() => {
                        petal.hp = 3; // reset to full hp
                        petal.isReloading = false;
                        io.emit('players', players); // update client
                    }, 1000);
                }

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
                io.emit('players', players);
            }
        });
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('players', players);
    });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
