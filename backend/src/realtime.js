const clients = new Set();
const qr = require('./utils/qr');

let dbListenerStarted = false;

function handleEvents(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`event: connected\ndata: {"status":"ok"}\n\n`);
    clients.add(res);

    req.on('close', () => {
        clients.delete(res);
    });
}

function broadcast(event, payload) {
    const data = JSON.stringify(payload || {});
    for (const res of clients) {
        res.write(`event: ${event}\ndata: ${data}\n\n`);
    }
}

setInterval(() => {
    for (const res of clients) {
        res.write(':keep-alive\n\n');
    }
}, 25000);

module.exports = {
    handleEvents,
    broadcast,
    startDbListener
};

function startDbListener() {
    if (dbListenerStarted) return;
    dbListenerStarted = true;

    const { Client } = require('pg');
    const client = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'worksync_db',
        user: process.env.DB_USER || 'worksync_user',
        password: process.env.DB_PASSWORD || 'worksync_secure_2026',
    });

    client.on('error', (err) => {
        console.error('DB notify listener error:', err.message);
    });

    client.connect()
        .then(() => client.query('LISTEN data_change'))
        .then(() => {
            console.log('DB notify listener connected (LISTEN data_change)');
        })
        .catch((err) => {
            console.error('Failed to start DB notify listener:', err.message);
        });

    client.on('notification', (msg) => {
        if (msg.channel !== 'data_change') return;
        try {
            const payload = msg.payload ? JSON.parse(msg.payload) : {};
            if (payload.action === 'INSERT') {
                if (payload.entity === 'employees' && payload.id) {
                    qr.generateEmployeeQrById(payload.id).catch(() => {});
                }
                if (payload.entity === 'production_lines' && payload.id) {
                    qr.generateLineQrById(payload.id).catch(() => {});
                }
                if (payload.entity === 'product_processes' && payload.id) {
                    qr.generateProcessQrById(payload.id).catch(() => {});
                }
                if (payload.entity === 'operations' && payload.id) {
                    qr.generateOperationQrById(payload.id).catch(() => {});
                }
            }
            broadcast('data_change', payload);
        } catch (err) {
            console.error('Invalid notify payload:', err.message);
        }
    });
}
