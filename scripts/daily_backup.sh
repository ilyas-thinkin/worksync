#!/bin/bash
#################################################################################
# WorkSync Daily Backup Script
# Backs up PostgreSQL database, reports, and QR codes
# Retains last 30 days of backups
#################################################################################

set -e  # Exit on error

# Configuration
BACKUP_BASE_DIR="/home/worksync/worksync/backups"
DATE=$(date +%Y-%m-%d_%H%M%S)
LOG_FILE="/home/worksync/worksync/logs/backup.log"

# Database credentials
DB_NAME="worksync_db"
DB_USER="worksync_user"
export PGPASSWORD="worksync_secure_2026"

# Create backup directory for today
BACKUP_DIR="$BACKUP_BASE_DIR/$DATE"
mkdir -p "$BACKUP_DIR"

# Log function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Starting WorkSync Backup ==="

# 1. Backup PostgreSQL database
log "Backing up database: $DB_NAME"
pg_dump -h 127.0.0.1 -U "$DB_USER" -F c -b -v \
    -f "$BACKUP_DIR/worksync_db.dump" "$DB_NAME" 2>&1 | tee -a "$LOG_FILE"

# 2. Backup reports directory
if [ -d "/home/worksync/worksync/reports" ]; then
    log "Backing up reports directory"
    rsync -av /home/worksync/worksync/reports/ "$BACKUP_DIR/reports/" >> "$LOG_FILE" 2>&1
fi

# 3. Backup QR codes directory
if [ -d "/home/worksync/worksync/qrcodes" ]; then
    log "Backing up QR codes directory"
    rsync -av /home/worksync/worksync/qrcodes/ "$BACKUP_DIR/qrcodes/" >> "$LOG_FILE" 2>&1
fi

# 4. Backup .env configuration (for disaster recovery)
if [ -f "/home/worksync/worksync/backend/.env" ]; then
    log "Backing up configuration file"
    cp /home/worksync/worksync/backend/.env "$BACKUP_DIR/.env.backup"
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
