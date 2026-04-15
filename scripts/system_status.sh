#!/bin/bash
#################################################################################
# WorkSync System Status Check
# Displays comprehensive system health information
#################################################################################

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/backend/.env"

if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
fi

DB_NAME="${DB_NAME:-worksync_db}"
APP_PORT="${PORT:-3000}"
BACKUP_ROOT="${BACKUP_DIR:-${ROOT_DIR}/backups}"
SERVICE_NAME="worksync-pm2"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         WorkSync Factory Production Tracking System           ║"
echo "║                   System Status Report                         ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# System Information
echo "═══ SYSTEM INFORMATION ═══"
echo "Hostname:          $(hostname)"
echo "IP Address:        $(hostname -I | awk '{print $1}')"
echo "OS:                $(cat /etc/os-release | grep PRETTY_NAME | cut -d '"' -f2)"
echo "Kernel:            $(uname -r)"
echo "Architecture:      $(uname -m)"
echo "Uptime:            $(uptime -p)"
echo ""

# Hardware Information
echo "═══ HARDWARE ═══"
cat /proc/device-tree/model 2>/dev/null && echo ""
echo "CPU:               $(lscpu | grep 'Model name' | cut -d: -f2 | xargs)"
echo "CPU Cores:         $(nproc)"
echo "Memory Total:      $(free -h | grep Mem | awk '{print $2}')"
echo "Memory Used:       $(free -h | grep Mem | awk '{print $3}')"
echo "Memory Available:  $(free -h | grep Mem | awk '{print $7}')"
echo "Disk Usage:        $(df -h / | tail -1 | awk '{print $3 " / " $2 " (" $5 ")"}')"
echo ""

# PostgreSQL Status
echo "═══ POSTGRESQL DATABASE ═══"
if systemctl is-active --quiet postgresql; then
    echo "Status:            ✓ Running"
    echo "Enabled on boot:   $(systemctl is-enabled postgresql)"
    PGVERSION=$(sudo -u postgres psql -t -c "SELECT version();" 2>/dev/null | head -1)
    echo "Version:           ${PGVERSION:0:50}..."
    echo "Active connections: $(sudo -u postgres psql -t -c "SELECT count(*) FROM pg_stat_activity WHERE datname='${DB_NAME}';" 2>/dev/null | xargs)"
    DBSIZE=$(sudo -u postgres psql -t -c "SELECT pg_size_pretty(pg_database_size('${DB_NAME}'));" 2>/dev/null | xargs)
    echo "Database size:     $DBSIZE"
else
    echo "Status:            ✗ Not running"
fi
echo ""

# WorkSync Service Status
echo "═══ WORKSYNC SERVICE ═══"
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "Status:            ✓ Running"
    echo "Enabled on boot:   $(systemctl is-enabled "$SERVICE_NAME")"
    PID=$(systemctl show -p MainPID "$SERVICE_NAME" | cut -d= -f2)
    echo "Process ID:        $PID"
    if [ "$PID" != "0" ]; then
        MEM=$(ps -p $PID -o rss= 2>/dev/null | awk '{printf "%.1f MB", $1/1024}')
        echo "Memory usage:      $MEM"
    fi
else
    echo "Status:            ✗ Not running"
    echo "Run: sudo systemctl start $SERVICE_NAME"
fi
if command -v pm2 >/dev/null 2>&1; then
    echo "PM2 app status:    $(pm2 describe worksync >/dev/null 2>&1 && echo "Registered" || echo "Not registered")"
fi
echo ""

# Network Configuration
echo "═══ NETWORK ═══"
echo "Listening on:      http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
echo "Local access:      http://localhost:${APP_PORT}"
echo "Health endpoint:   http://$(hostname -I | awk '{print $1}'):${APP_PORT}/health"
echo ""

# Backup Status
echo "═══ BACKUP STATUS ═══"
if [ -d "$BACKUP_ROOT" ]; then
    BACKUP_COUNT=$(ls -1d "$BACKUP_ROOT"/20* 2>/dev/null | wc -l)
    echo "Total backups:     $BACKUP_COUNT"
    if [ $BACKUP_COUNT -gt 0 ]; then
        LATEST=$(ls -1dt "$BACKUP_ROOT"/20* 2>/dev/null | head -1 | xargs basename)
        echo "Latest backup:     $LATEST"
        BACKUP_SIZE=$(du -sh "$BACKUP_ROOT/$LATEST" 2>/dev/null | cut -f1)
        echo "Backup size:       $BACKUP_SIZE"
    fi
    echo "Scheduled:         Daily at 2:00 AM (cron)"
else
    echo "Status:            No backups found"
fi
echo ""

# Directory Status
echo "═══ STORAGE DIRECTORIES ═══"
for dir in reports qrcodes logs backups; do
    DIR_PATH="${ROOT_DIR}/$dir"
    if [ -d "$DIR_PATH" ]; then
        COUNT=$(ls -1 "$DIR_PATH" 2>/dev/null | wc -l)
        SIZE=$(du -sh "$DIR_PATH" 2>/dev/null | cut -f1)
        printf "%-10s  %5s files  %8s\n" "$dir:" "$COUNT" "$SIZE"
    fi
done
echo ""

echo "═══ QUICK ACTIONS ═══"
echo "Start service:     sudo systemctl start ${SERVICE_NAME}"
echo "Stop service:      sudo systemctl stop ${SERVICE_NAME}"
echo "Restart service:   sudo systemctl restart ${SERVICE_NAME}"
echo "View logs:         sudo journalctl -u ${SERVICE_NAME} -f"
echo "Run backup:        ${ROOT_DIR}/scripts/daily_backup.sh"
echo "System status:     ${ROOT_DIR}/scripts/system_status.sh"
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    End of Status Report                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
