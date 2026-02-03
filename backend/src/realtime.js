const clients = new Set();
const qr = require('./utils/qr');

let dbListenerStarted = false;
let dbClient = null;

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

function closeAllConnections() {
    // Close all SSE client connections
    for (const res of clients) {
        try {
            res.end();
        } catch (err) {
            // ignore
        }
    }
    clients.clear();

    // Close database listener
    if (dbClient) {
        dbClient.end().catch(() => {});
        dbClient = null;
    }
}

module.exports = {
    handleEvents,
    broadcast,
    startDbListener,
    closeAllConnections
};

function startDbListener() {
    if (dbListenerStarted) return;
    dbListenerStarted = true;

    const { Client } = require('pg');
    dbClient = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'worksync_db',
        user: process.env.DB_USER || 'worksync_user',
        password: process.env.DB_PASSWORD || 'worksync_secure_2026',
    });

    dbClient.on('error', (err) => {
        console.error('DB notify listener error:', err.message);
    });

    dbClient.connect()
        .then(() => dbClient.query('LISTEN data_change'))
        .then(() => {
            console.log('DB notify listener connected (LISTEN data_change)');
        })
        .catch((err) => {
            console.error('Failed to start DB notify listener:', err.message);
        });

    dbClient.on('notification', (msg) => {
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
