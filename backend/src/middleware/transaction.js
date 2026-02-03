/**
 * WorkSync Database Transaction Helper
 * Provides utilities for ACID-compliant database operations
 */

const pool = require('../config/db.config');

/**
 * Execute a function within a database transaction
 * Automatically handles commit/rollback
 *
 * @param {Function} fn - Async function that receives the client
 * @returns {Promise<any>} - Result from the function
 *
 * @example
 * const result = await withTransaction(async (client) => {
 *     await client.query('INSERT INTO ...');
 *     await client.query('UPDATE ...');
 *     return { success: true };
 * });
 */
async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Execute a function with a database client (no transaction)
 * Useful for read operations or when transaction is managed externally
 *
 * @param {Function} fn - Async function that receives the client
 * @returns {Promise<any>} - Result from the function
 */
async function withClient(fn) {
    const client = await pool.connect();
    try {
        return await fn(client);
    } finally {
        client.release();
    }
}

/**
 * Transaction isolation levels
 */
const IsolationLevel = {
    READ_UNCOMMITTED: 'READ UNCOMMITTED',
    READ_COMMITTED: 'READ COMMITTED',      // PostgreSQL default
    REPEATABLE_READ: 'REPEATABLE READ',
    SERIALIZABLE: 'SERIALIZABLE'
};

/**
 * Execute with specific isolation level
 *
 * @param {Function} fn - Async function that receives the client
 * @param {string} isolationLevel - Isolation level from IsolationLevel enum
 * @returns {Promise<any>} - Result from the function
 */
async function withIsolation(fn, isolationLevel = IsolationLevel.READ_COMMITTED) {
    const client = await pool.connect();
    try {
        await client.query(`BEGIN TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Retry a transaction on serialization failure
 * Useful for high-contention scenarios
 *
 * @param {Function} fn - Async function that receives the client
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} baseDelay - Base delay in ms between retries
 * @returns {Promise<any>} - Result from the function
 */
async function withRetry(fn, maxRetries = 3, baseDelay = 100) {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await withTransaction(fn);
        } catch (error) {
            lastError = error;

            // Check if it's a serialization failure (can retry)
            const isSerializationError =
                error.code === '40001' || // PostgreSQL serialization_failure
                error.code === '40P01';   // PostgreSQL deadlock_detected

            if (!isSerializationError || attempt === maxRetries) {
                throw error;
            }

            // Exponential backoff with jitter
            const delay = baseDelay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

/**
 * Create a savepoint within a transaction
 * Allows partial rollback
 *
 * @param {Object} client - Database client
 * @param {string} name - Savepoint name
 */
async function createSavepoint(client, name) {
    await client.query(`SAVEPOINT ${name}`);
}

/**
 * Rollback to a savepoint
 *
 * @param {Object} client - Database client
 * @param {string} name - Savepoint name
 */
async function rollbackToSavepoint(client, name) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
}

/**
 * Release a savepoint (allows GC)
 *
 * @param {Object} client - Database client
 * @param {string} name - Savepoint name
 */
async function releaseSavepoint(client, name) {
    await client.query(`RELEASE SAVEPOINT ${name}`);
}

/**
 * Middleware for route handlers that need transactions
 * Attaches transaction helper to req object
 */
function transactionMiddleware(req, res, next) {
    req.withTransaction = withTransaction;
    req.withRetry = withRetry;
    next();
}

/**
 * Lock a table row for update (SELECT FOR UPDATE)
 * Prevents concurrent modifications
 *
 * @param {Object} client - Database client
 * @param {string} table - Table name
 * @param {string} column - Column to match
 * @param {any} value - Value to match
 * @returns {Object} - Locked row
 */
async function lockForUpdate(client, table, column, value) {
    const result = await client.query(
        `SELECT * FROM ${table} WHERE ${column} = $1 FOR UPDATE`,
        [value]
    );
    return result.rows[0];
}

/**
 * Lock multiple rows for update
 *
 * @param {Object} client - Database client
 * @param {string} table - Table name
 * @param {string} column - Column to match
 * @param {Array} values - Values to match
 * @returns {Array} - Locked rows
 */
async function lockRowsForUpdate(client, table, column, values) {
    const result = await client.query(
        `SELECT * FROM ${table} WHERE ${column} = ANY($1) FOR UPDATE`,
        [values]
    );
    return result.rows;
}

module.exports = {
    withTransaction,
    withClient,
    withIsolation,
    withRetry,
    IsolationLevel,
    createSavepoint,
    rollbackToSavepoint,
    releaseSavepoint,
    transactionMiddleware,
    lockForUpdate,
    lockRowsForUpdate
};
