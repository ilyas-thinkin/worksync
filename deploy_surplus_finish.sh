#!/bin/bash
# Deploy the staging branch surplus-finish-primary (OLD WS surplus stations + CO switch time / split hours) to live.
# Run AFTER shift, as worksync.
set -euo pipefail
LIVE=/home/worksync/worksync/backend
STG=/home/worksync/worksync-staging/backend
FILES="src/routes/api.routes.js src/public/js/supervisor.js src/public/supervisor.html"
# Refuse if live changed since the baseline the change was built on.
for f in $FILES; do
  if ! git -C /home/worksync/worksync-staging show 27b9a32:backend/$f | cmp -s - "$LIVE/$f"; then
    echo "ABORT: live $f changed since baseline 27b9a32 — merge first"; exit 1
  fi
done
TS=$(date +%Y%m%d-%H%M%S); mkdir -p /home/worksync/worksync/backups/pre-surplus-$TS
for f in $FILES; do cp "$LIVE/$f" /home/worksync/worksync/backups/pre-surplus-$TS/$(basename $f); done
for m in 054_surplus_workstation_close.sql 055_history_split_minutes.sql; do
  PGPASSWORD=worksync_secure_2026 psql -h 127.0.0.1 -U worksync_user -d worksync_db -v ON_ERROR_STOP=1 -f $STG/src/migrations/$m
  cp $STG/src/migrations/$m $LIVE/src/migrations/
done
for f in $FILES; do cp "$STG/$f" "$LIVE/$f"; done
node --check $LIVE/src/routes/api.routes.js
pm2 restart worksync
echo "Deployed. Backup of previous files: /home/worksync/worksync/backups/pre-surplus-$TS"
