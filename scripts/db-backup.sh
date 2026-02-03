#!/bin/bash
#
# WorkSync Database Backup Script
# Performs automated PostgreSQL backups with retention policy
#
# Usage:
#   ./db-backup.sh                     # Full backup
#   ./db-backup.sh --schema-only       # Schema only backup
#   ./db-backup.sh --cleanup           # Run cleanup only
#
# Cron example (daily at 2 AM):
#   0 2 * * * /home/worksync/worksync/scripts/db-backup.sh >> /home/worksync/worksync/logs/backup.log 2>&1
#

set -e

# Configuration
BACKUP_DIR="/home/worksync/worksync/backups"
DB_NAME="worksync_db"
DB_USER="worksync_user"
DB_HOST="127.0.0.1"
DB_PORT="5432"
PGPASSWORD="worksync_secure_2026"
export PGPASSWORD

# Retention settings
DAILY_RETENTION=7       # Keep daily backups for 7 days
WEEKLY_RETENTION=4      # Keep weekly backups for 4 weeks
MONTHLY_RETENTION=3     # Keep monthly backups for 3 months

# Timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATE=$(date +%Y%m%d)
WEEKDAY=$(date +%u)  # 1=Monday, 7=Sunday
DAY_OF_MONTH=$(date +%d)

# Log function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Create backup directories
create_directories() {
    mkdir -p "$BACKUP_DIR/daily"
    mkdir -p "$BACKUP_DIR/weekly"
    mkdir -p "$BACKUP_DIR/monthly"
    mkdir -p "$BACKUP_DIR/schema"
}

# Perform database backup
perform_backup() {
    local backup_type=$1
    local backup_file=""
    local backup_path=""

    case $backup_type in
        "daily")
            backup_file="worksync_daily_${TIMESTAMP}.sql.gz"
            backup_path="$BACKUP_DIR/daily/$backup_file"
            ;;
        "weekly")
            backup_file="worksync_weekly_${TIMESTAMP}.sql.gz"
            backup_path="$BACKUP_DIR/weekly/$backup_file"
            ;;
        "monthly")
            backup_file="worksync_monthly_${TIMESTAMP}.sql.gz"
            backup_path="$BACKUP_DIR/monthly/$backup_file"
            ;;
        "schema")
            backup_file="worksync_schema_${TIMESTAMP}.sql"
            backup_path="$BACKUP_DIR/schema/$backup_file"
            ;;
    esac

    log "Starting $backup_type backup..."

    if [ "$backup_type" = "schema" ]; then
        pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
            --schema-only --no-owner --no-privileges \
            > "$backup_path"
    else
        pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
            --no-owner --no-privileges \
            | gzip > "$backup_path"
    fi

    local file_size=$(du -h "$backup_path" | cut -f1)
    log "Backup completed: $backup_file ($file_size)"
}

# Cleanup old backups
cleanup_backups() {
    log "Cleaning up old backups..."

    # Daily cleanup (older than DAILY_RETENTION days)
    find "$BACKUP_DIR/daily" -name "worksync_daily_*.sql.gz" -mtime +$DAILY_RETENTION -delete 2>/dev/null || true
    local daily_count=$(find "$BACKUP_DIR/daily" -name "*.sql.gz" 2>/dev/null | wc -l)
    log "Daily backups retained: $daily_count"

    # Weekly cleanup (older than WEEKLY_RETENTION weeks)
    find "$BACKUP_DIR/weekly" -name "worksync_weekly_*.sql.gz" -mtime +$((WEEKLY_RETENTION * 7)) -delete 2>/dev/null || true
    local weekly_count=$(find "$BACKUP_DIR/weekly" -name "*.sql.gz" 2>/dev/null | wc -l)
    log "Weekly backups retained: $weekly_count"

    # Monthly cleanup (older than MONTHLY_RETENTION months)
    find "$BACKUP_DIR/monthly" -name "worksync_monthly_*.sql.gz" -mtime +$((MONTHLY_RETENTION * 30)) -delete 2>/dev/null || true
    local monthly_count=$(find "$BACKUP_DIR/monthly" -name "*.sql.gz" 2>/dev/null | wc -l)
    log "Monthly backups retained: $monthly_count"

    # Keep only last 5 schema backups
    cd "$BACKUP_DIR/schema" 2>/dev/null && ls -t worksync_schema_*.sql 2>/dev/null | tail -n +6 | xargs -r rm --
    local schema_count=$(find "$BACKUP_DIR/schema" -name "*.sql" 2>/dev/null | wc -l)
    log "Schema backups retained: $schema_count"
}

# Verify backup integrity
verify_backup() {
    local backup_file=$1

    if [ -f "$backup_file" ]; then
        # Test if gzip file is valid
        if gzip -t "$backup_file" 2>/dev/null; then
            log "Backup verification passed: $backup_file"
            return 0
        else
            log "ERROR: Backup verification failed: $backup_file"
            return 1
        fi
    else
        log "ERROR: Backup file not found: $backup_file"
        return 1
    fi
}

# Get backup statistics
show_stats() {
    log "=== Backup Statistics ==="

    local total_size=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
    log "Total backup size: $total_size"

    local daily_size=$(du -sh "$BACKUP_DIR/daily" 2>/dev/null | cut -f1)
    local weekly_size=$(du -sh "$BACKUP_DIR/weekly" 2>/dev/null | cut -f1)
    local monthly_size=$(du -sh "$BACKUP_DIR/monthly" 2>/dev/null | cut -f1)

    log "  Daily: $daily_size"
    log "  Weekly: $weekly_size"
    log "  Monthly: $monthly_size"

    # Latest backup info
    local latest_daily=$(ls -t "$BACKUP_DIR/daily"/*.sql.gz 2>/dev/null | head -1)
    if [ -n "$latest_daily" ]; then
        log "Latest daily: $(basename $latest_daily)"
    fi
}

# Main execution
main() {
    log "=========================================="
    log "  WorkSync Database Backup"
    log "=========================================="

    create_directories

    case "${1:-}" in
        "--schema-only")
            perform_backup "schema"
            ;;
        "--cleanup")
            cleanup_backups
            show_stats
            ;;
        *)
            # Always perform daily backup
            perform_backup "daily"
            verify_backup "$BACKUP_DIR/daily/worksync_daily_${TIMESTAMP}.sql.gz"

            # Weekly backup on Sunday
            if [ "$WEEKDAY" = "7" ]; then
                perform_backup "weekly"
            fi

            # Monthly backup on 1st of month
            if [ "$DAY_OF_MONTH" = "01" ]; then
                perform_backup "monthly"
            fi

            # Schema backup once a week on Monday
            if [ "$WEEKDAY" = "1" ]; then
                perform_backup "schema"
            fi

            cleanup_backups
            show_stats
            ;;
    esac

    log "=========================================="
    log "  Backup process completed"
    log "=========================================="
}

# Run main
main "$@"
