const clients = new Set();
const crypto = require('crypto');
const qr = require('./utils/qr');
const pool = require('./config/db.config');

// `clients` only ever holds the SSE connections of THIS process, and the app runs as a PM2
// cluster (4 workers). A browser's EventSource is pinned to whichever worker accepted it, while
// its writes are load-balanced across all four — so a broadcast made straight to `clients` was
// seen by roughly one client in four and silently lost for the rest. Every broadcast is now
// published on the same `data_change` channel the workers already LISTEN to, and each worker
// relays it to its own clients. Only the six tables with a notify trigger crossed workers before.
const NOTIFY_CHANNEL = 'data_change';
// Marks a notification this module published, to tell it apart from a raw DB-trigger payload.
const APP_EVENT_KEY = '__ws_app_event';
// pg_notify refuses a payload of 8000 bytes or more; stay clear of the edge.
const NOTIFY_MAX_BYTES = 7000;
// Identifies this worker, so it can ignore the echo of its own publish (already delivered).
const INSTANCE_ID = crypto.randomUUID();

let dbListenerStarted = false;
let dbClient = null;

const requireEnv = (name) => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
};

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

// Writes to this worker's own SSE clients. Everything that reaches a browser goes through here:
// a local broadcast, and a publish relayed from another worker.
function deliverLocal(event, payload) {
    const data = JSON.stringify(payload || {});
    for (const res of clients) {
        res.write(`event: ${event}\ndata: ${data}\n\n`);
    }
}

// Sends to every worker's clients, not just this one's. Local delivery stays synchronous so a
// client on this worker updates at the same speed as before and keeps working even if the
// notify listener is down; the other workers are reached through Postgres a moment later.
function broadcast(event, payload) {
    deliverLocal(event, payload);

    const envelope = JSON.stringify({
        [APP_EVENT_KEY]: event,
        origin: INSTANCE_ID,
        payload: payload || {}
    });
    if (Buffer.byteLength(envelope) > NOTIFY_MAX_BYTES) {
        // Broadcast payloads are identifiers ({entity, action, id}), never rows — if one is this
        // big something upstream is sending the record itself, and cross-worker delivery is
        // dropped rather than throwing. Local clients above still got it.
        console.error(`Broadcast payload too large to publish across workers (${event})`);
        return;
    }
    pool.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, envelope])
        .catch((err) => console.error('Failed to publish broadcast across workers:', err.message));
}

setInterval(() => {
    for (const res of clients) {
        res.write('event: heartbeat\ndata: {}\n\n');
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
        password: requireEnv('DB_PASSWORD'),
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
        if (msg.channel !== NOTIFY_CHANNEL) return;
        try {
            const payload = msg.payload ? JSON.parse(msg.payload) : {};

            // Published by broadcast() on some worker. Relay it to this worker's clients and
            // stop — calling broadcast() here would publish it again, round and round forever.
            if (payload && typeof payload[APP_EVENT_KEY] === 'string') {
                if (payload.origin === INSTANCE_ID) return; // our own echo; already delivered
                deliverLocal(payload[APP_EVENT_KEY], payload.payload || {});
                return;
            }

            // Otherwise it came from one of the table triggers, whose payload is the event itself.
            if (payload.action === 'INSERT') {
                if (payload.entity === 'employees' && payload.id) {
                    qr.generateEmployeeQrById(payload.id).catch(() => {});
                }
                if (payload.entity === 'production_lines' && payload.id) {
                    qr.generateLineQrById(payload.id).catch(() => {});
                }
            }
            deliverLocal('data_change', payload);
        } catch (err) {
            console.error('Invalid notify payload:', err.message);
        }
    });
}
