#!/bin/bash
#################################################################################
# WorkSync Daily Backup Script
# Backs up PostgreSQL database, reports, and QR codes
# Retains last 30 days of backups
#################################################################################

set -e  # Exit on error

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/backend/.env"

if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
fi

BACKUP_BASE_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
DATE=$(date +%Y-%m-%d_%H%M%S)
LOG_FILE="${LOGS_DIR:-${ROOT_DIR}/logs}/backup.log"

# Database credentials
DB_NAME="${DB_NAME:-worksync_db}"
DB_USER="${DB_USER:-worksync_user}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
export PGPASSWORD="${DB_PASSWORD:-worksync_secure_2026}"

# Create backup directory for today
BACKUP_DIR="$BACKUP_BASE_DIR/$DATE"
mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

# Log function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Starting WorkSync Backup ==="

# 1. Backup PostgreSQL database
log "Backing up database: $DB_NAME"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -F c -b -v \
    -f "$BACKUP_DIR/worksync_db.dump" "$DB_NAME" 2>&1 | tee -a "$LOG_FILE"

# 2. Backup reports directory
if [ -d "${REPORTS_DIR:-${ROOT_DIR}/reports}" ]; then
    log "Backing up reports directory"
    rsync -av "${REPORTS_DIR:-${ROOT_DIR}/reports}/" "$BACKUP_DIR/reports/" >> "$LOG_FILE" 2>&1
fi

# 3. Backup QR codes directory
if [ -d "${QRCODES_DIR:-${ROOT_DIR}/qrcodes}" ]; then
    log "Backing up QR codes directory"
    rsync -av "${QRCODES_DIR:-${ROOT_DIR}/qrcodes}/" "$BACKUP_DIR/qrcodes/" >> "$LOG_FILE" 2>&1
fi

# 4. Backup .env configuration (for disaster recovery)
if [ -f "$ENV_FILE" ]; then
    log "Backing up configuration file"
    cp "$ENV_FILE" "$BACKUP_DIR/.env.backup"
fi

# 5. Create backup manifest
cat > "$BACKUP_DIR/backup_manifest.txt" << MANIFEST
WorkSync Backup Manifest
========================
Backup Date: $DATE
Database: $DB_NAME
Hostname: $(hostname)
IP Address: $(hostname -I | awk '{print $1}')

Contents:
- worksync_db.dump (PostgreSQL database)
- reports/ (Excel reports)
- qrcodes/ (QR code images)
- .env.backup (configuration)

Backup completed at: $(date)
MANIFEST

# 6. Calculate backup size
BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
log "Backup completed successfully. Size: $BACKUP_SIZE"

# 7. Cleanup old backups (keep last 30 days)
log "Cleaning up backups older than 30 days"
find "$BACKUP_BASE_DIR" -maxdepth 1 -type d -mtime +30 -exec rm -rf {} \; 2>/dev/null || true

# 8. Show disk usage
DISK_USAGE=$(df -h "$BACKUP_BASE_DIR" | tail -1 | awk '{print $5}')
log "Disk usage on backup directory: $DISK_USAGE"

log "=== Backup Completed Successfully ==="

# Unset password
unset PGPASSWORD

exit 0
