#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const pool = require('../config/db.config');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((row) => row.filename));
}

function getMigrationFiles() {
  const migrationsDir = path.resolve(__dirname, '..', 'migrations');
  return fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      filename: file,
      fullPath: path.join(migrationsDir, file)
    }));
}

async function applyMigration(client, migration) {
  const sql = fs.readFileSync(migration.fullPath, 'utf8').trim();
  if (!sql) {
    console.log(`Skipping empty migration ${migration.filename}`);
    return;
  }

  console.log(`Applying migration ${migration.filename}`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, NOW())',
      [migration.filename]
    );
    await client.query('COMMIT');
    console.log(`Applied migration ${migration.filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const migrations = getMigrationFiles();

    let appliedCount = 0;
    for (const migration of migrations) {
      if (applied.has(migration.filename)) {
        continue;
      }
      await applyMigration(client, migration);
      appliedCount += 1;
    }

    console.log(`Migration run complete. Applied ${appliedCount} new migration(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (err) => {
  console.error(`Migration run failed: ${err.message}`);
  try {
    await pool.end();
  } catch (closeErr) {
    // ignore pool close errors during failure handling
  }
  process.exit(1);
});
