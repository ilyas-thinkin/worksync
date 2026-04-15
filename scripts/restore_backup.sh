#!/bin/bash
#################################################################################
# WorkSync Restore Script
# Restores database and files from a backup
#################################################################################

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/backend/.env"

if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
fi

# Check if backup directory is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <backup_directory>"
    echo "Example: $0 ${ROOT_DIR}/backups/2026-01-12_020000"
    echo ""
    echo "Available backups:"
    ls -1dt "${ROOT_DIR}"/backups/20* 2>/dev/null | head -10
    exit 1
fi

BACKUP_DIR="$1"

if [ ! -d "$BACKUP_DIR" ]; then
    echo "Error: Backup directory not found: $BACKUP_DIR"
    exit 1
fi

# Configuration
DB_NAME="${DB_NAME:-worksync_db}"
DB_USER="${DB_USER:-worksync_user}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
export PGPASSWORD="${DB_PASSWORD:-worksync_secure_2026}"

echo "=== WorkSync Restore ==="
echo "Backup source: $BACKUP_DIR"
echo ""
read -p "This will OVERWRITE current data. Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
fi

# Stop WorkSync service
echo "Stopping WorkSync service..."
sudo systemctl stop worksync-pm2 || true
pm2 kill 2>/dev/null || true

# Restore database
if [ -f "$BACKUP_DIR/worksync_db.dump" ]; then
    echo "Restoring database..."
    # Drop and recreate database
    sudo -u postgres psql -v ON_ERROR_STOP=1 postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"
    sudo -u postgres psql -v ON_ERROR_STOP=1 postgres -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
    
    # Restore from dump
    pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v "$BACKUP_DIR/worksync_db.dump"
    echo "Database restored successfully."
fi

# Restore reports
if [ -d "$BACKUP_DIR/reports" ]; then
    echo "Restoring reports..."
    rsync -av "$BACKUP_DIR/reports/" "${REPORTS_DIR:-${ROOT_DIR}/reports}/"
fi

# Restore QR codes
if [ -d "$BACKUP_DIR/qrcodes" ]; then
    echo "Restoring QR codes..."
    rsync -av "$BACKUP_DIR/qrcodes/" "${QRCODES_DIR:-${ROOT_DIR}/qrcodes}/"
fi

# Start WorkSync service
echo "Starting WorkSync service..."
pm2 start "${ROOT_DIR}/backend/ecosystem.config.js" --only worksync --update-env
pm2 save
sudo systemctl start worksync-pm2 || true

echo ""
echo "=== Restore Completed Successfully ==="

unset PGPASSWORD
exit 0
