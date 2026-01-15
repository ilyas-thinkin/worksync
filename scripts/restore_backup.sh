#!/bin/bash
#################################################################################
# WorkSync Restore Script
# Restores database and files from a backup
#################################################################################

set -e

# Check if backup directory is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <backup_directory>"
    echo "Example: $0 /home/worksync/worksync/backups/2026-01-12_020000"
    echo ""
    echo "Available backups:"
    ls -1dt /home/worksync/worksync/backups/20* 2>/dev/null | head -10
    exit 1
fi

BACKUP_DIR="$1"

if [ ! -d "$BACKUP_DIR" ]; then
    echo "Error: Backup directory not found: $BACKUP_DIR"
    exit 1
fi

# Configuration
DB_NAME="worksync_db"
DB_USER="worksync_user"
export PGPASSWORD="worksync_secure_2026"

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
sudo systemctl stop worksync || true

# Restore database
if [ -f "$BACKUP_DIR/worksync_db.dump" ]; then
    echo "Restoring database..."
    # Drop and recreate database
    psql -h 127.0.0.1 -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
    psql -h 127.0.0.1 -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME;"
    
    # Restore from dump
    pg_restore -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -v "$BACKUP_DIR/worksync_db.dump"
    echo "Database restored successfully."
fi

# Restore reports
if [ -d "$BACKUP_DIR/reports" ]; then
    echo "Restoring reports..."
    rsync -av "$BACKUP_DIR/reports/" /home/worksync/worksync/reports/
fi

# Restore QR codes
if [ -d "$BACKUP_DIR/qrcodes" ]; then
    echo "Restoring QR codes..."
    rsync -av "$BACKUP_DIR/qrcodes/" /home/worksync/worksync/qrcodes/
fi

# Start WorkSync service
echo "Starting WorkSync service..."
sudo systemctl start worksync

echo ""
echo "=== Restore Completed Successfully ==="

unset PGPASSWORD
exit 0
