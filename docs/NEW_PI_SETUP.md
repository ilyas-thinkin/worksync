# WorkSync Fresh Raspberry Pi Setup

This repo now includes a portable bootstrap flow for a fresh Raspberry Pi.

## Fast Path

From the cloned repo root:

```bash
chmod +x scripts/setup-new-pi.sh scripts/bootstrap-db.sh scripts/setup-pm2.sh
./scripts/setup-new-pi.sh
```

That flow will:

1. Install PostgreSQL, Node.js, and PM2 if missing.
2. Create `backend/.env` from `deploy/env/backend.env` if present, otherwise from `backend/.env.example`.
3. Install backend dependencies with `npm ci`.
4. Create the PostgreSQL role/database.
5. Load the tracked schema snapshot from `backend/src/schema.base.sql` only when the database is empty.
6. Register PM2 and install the `worksync-pm2` systemd service.

## Existing Server Data Safety

- Normal admin `Pull Latest Changes` updates do not reset the database. They preserve existing server data and only run pending migrations.
- `scripts/bootstrap-db.sh` now also preserves existing data by default. If it detects tables already present in the target database, it skips the schema reset.
- The database is reset only when:
  - you restore a backup with `--restore`
  - you explicitly run `scripts/bootstrap-db.sh --force-reset`

## Restore Existing Data

If you want to move real data from another Pi, pass a backup file:

```bash
./scripts/setup-new-pi.sh --restore-backup /path/to/worksync_daily_YYYYMMDD_HHMMSS.sql.gz
```

Supported restore formats:

- `.sql.gz`
- `.sql`
- `.dump`

When restoring a full backup, the bootstrap script does not auto-run migrations afterward. That is intentional, because a full backup already represents a specific schema state.

## Force Rebuild From Repo Schema

If you intentionally want to wipe the current database and rebuild it from the repo schema snapshot:

```bash
./scripts/bootstrap-db.sh --force-reset
```

## Files Added For Portability

- `backend/.env.example`
- `backend/src/schema.base.sql`
- `backend/src/schema.base.migrations`
- `scripts/bootstrap-db.sh`
- `scripts/setup-new-pi.sh`
- `deploy/systemd/worksync-pm2.service`

## Useful Commands

```bash
sudo systemctl status worksync-pm2
pm2 status
pm2 logs worksync
./scripts/system_status.sh
```
