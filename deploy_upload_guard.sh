#!/usr/bin/env bash
# Deploy: shared-process upload guard + "copied, not confirmed" flag + plan change log.
# Run AFTER the shift. Copies the tested files from the staging worktree into the live folder,
# applies migration 053 to the live DB, and reloads PM2 one worker at a time.
set -euo pipefail

LIVE=/home/worksync/worksync
STAGE=/home/worksync/worksync-staging
STAMP=$(date +%Y%m%d_%H%M%S)
BACKUP=$LIVE/backups/pre_upload_guard_$STAMP
FILES=(
  backend/src/routes/api.routes.js
  backend/src/public/js/admin.js
  backend/src/public/js/supervisor.js
  backend/src/public/admin.html
  backend/src/public/ie.html
  backend/src/public/supervisor.html
)
NEW_FILES=(
  backend/src/utils/plan-change-log.js
  backend/src/migrations/053_plan_change_log_and_carry_flag.sql
)

# 1. Refuse if anyone changed the live files since the staging copy was taken (commit 3dc0f29).
for f in "${FILES[@]}"; do
  if ! git -C "$LIVE" diff --quiet 3dc0f29 -- "$f"; then
    echo "ABORT: $f changed in the live folder since staging was made. Merge first." >&2
    exit 1
  fi
done

# 2. Back up the live files and the DB.
mkdir -p "$BACKUP"
for f in "${FILES[@]}"; do mkdir -p "$BACKUP/$(dirname "$f")"; cp -p "$LIVE/$f" "$BACKUP/$f"; done
PGPASSWORD=worksync_secure_2026 pg_dump -h 127.0.0.1 -U worksync_user -d worksync_db | gzip > "$BACKUP/worksync_db.sql.gz"
echo "Backup: $BACKUP"

# 3. Migration first: it only adds a table and two nullable columns, which the running (old)
#    code ignores, so applying it before the reload is safe.
PGPASSWORD=worksync_secure_2026 psql -h 127.0.0.1 -U worksync_user -d worksync_db -v ON_ERROR_STOP=1 \
  -f "$STAGE/backend/src/migrations/053_plan_change_log_and_carry_flag.sql"

# 4. Copy code.
for f in "${FILES[@]}" "${NEW_FILES[@]}"; do cp -p "$STAGE/$f" "$LIVE/$f"; done
node --check "$LIVE/backend/src/routes/api.routes.js"
node --check "$LIVE/backend/src/utils/plan-change-log.js"

# 5. Rolling reload (no downtime), then show status.
pm2 reload worksync
pm2 status worksync

# 6. Keep the code graph current (CLAUDE.md).
(cd "$LIVE" && graphify update backend/src) || echo "graphify update failed (non-fatal)"

echo "Done. Roll back with: cp -rp $BACKUP/backend $LIVE/ && pm2 reload worksync"
echo "(The migration can stay: old code ignores the new table/columns.)"
