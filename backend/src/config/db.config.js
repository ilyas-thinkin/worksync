const { Pool, types } = require('pg');
require('dotenv').config();

// Return DATE columns as plain strings (YYYY-MM-DD) instead of JS Date objects.
// Without this, pg interprets dates as UTC midnight, causing off-by-one errors in IST (UTC+5:30).
types.setTypeParser(1082, val => val);

const requireEnv = (name) => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
};

const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'worksync_db',
    user: process.env.DB_USER || 'worksync_user',
    password: requireEnv('DB_PASSWORD'),
    max: 40,                     // enough for 50 concurrent users
    min: 5,                      // keep 5 warm connections ready at all times
    idleTimeoutMillis: 60000,    // hold idle connections for 60s before releasing
    connectionTimeoutMillis: 15000, // wait up to 15s for a free connection
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

module.exports = pool;
