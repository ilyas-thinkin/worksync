#!/bin/bash
#################################################################################
# WorkSync System Status Check
# Displays comprehensive system health information
#################################################################################

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
    echo "Active connections: $(sudo -u postgres psql -t -c "SELECT count(*) FROM pg_stat_activity WHERE datname='worksync_db';" 2>/dev/null | xargs)"
    DBSIZE=$(sudo -u postgres psql -t -c "SELECT pg_size_pretty(pg_database_size('worksync_db'));" 2>/dev/null | xargs)
    echo "Database size:     $DBSIZE"
else
    echo "Status:            ✗ Not running"
fi
echo ""

# WorkSync Service Status
echo "═══ WORKSYNC SERVICE ═══"
if systemctl is-active --quiet worksync; then
    echo "Status:            ✓ Running"
    echo "Enabled on boot:   $(systemctl is-enabled worksync)"
    PID=$(systemctl show -p MainPID worksync | cut -d= -f2)
    echo "Process ID:        $PID"
    if [ "$PID" != "0" ]; then
        MEM=$(ps -p $PID -o rss= 2>/dev/null | awk '{printf "%.1f MB", $1/1024}')
        echo "Memory usage:      $MEM"
    fi
else
    echo "Status:            ✗ Not running"
    echo "Run: sudo systemctl start worksync"
fi
echo ""

# Network Configuration
echo "═══ NETWORK ═══"
echo "Listening on:      http://$(hostname -I | awk '{print $1}'):3000"
echo "Local access:      http://localhost:3000"
echo "Health endpoint:   http://$(hostname -I | awk '{print $1}'):3000/health"
echo ""

# Backup Status
echo "═══ BACKUP STATUS ═══"
BACKUP_DIR="/home/worksync/worksync/backups"
if [ -d "$BACKUP_DIR" ]; then
    BACKUP_COUNT=$(ls -1d $BACKUP_DIR/20* 2>/dev/null | wc -l)
    echo "Total backups:     $BACKUP_COUNT"
    if [ $BACKUP_COUNT -gt 0 ]; then
        LATEST=$(ls -1dt $BACKUP_DIR/20* 2>/dev/null | head -1 | xargs basename)
        echo "Latest backup:     $LATEST"
        BACKUP_SIZE=$(du -sh $BACKUP_DIR/$LATEST 2>/dev/null | cut -f1)
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
    DIR_PATH="/home/worksync/worksync/$dir"
    if [ -d "$DIR_PATH" ]; then
        COUNT=$(ls -1 "$DIR_PATH" 2>/dev/null | wc -l)
        SIZE=$(du -sh "$DIR_PATH" 2>/dev/null | cut -f1)
        printf "%-10s  %5s files  %8s\n" "$dir:" "$COUNT" "$SIZE"
    fi
done
echo ""

echo "═══ QUICK ACTIONS ═══"
echo "Start service:     sudo systemctl start worksync"
echo "Stop service:      sudo systemctl stop worksync"
echo "Restart service:   sudo systemctl restart worksync"
echo "View logs:         sudo journalctl -u worksync -f"
echo "Run backup:        ~/worksync/scripts/daily_backup.sh"
echo "System status:     ~/worksync/scripts/system_status.sh"
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    End of Status Report                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
