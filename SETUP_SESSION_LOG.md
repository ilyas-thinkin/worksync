# WorkSync Setup Session - Complete Command Log
**Date:** January 12, 2026
**System:** Raspberry Pi 5 Model B (8GB RAM)
**IP Address:** 192.168.1.9
**Hostname:** worksync

---

## Session Overview

This document contains ALL commands and configurations performed during the initial WorkSync Raspberry Pi setup session. Use this as a reference for future maintenance or to replicate the setup on another system.

---

## 1. System Verification

### Hardware & OS Detection
```bash
# Check OS and kernel
uname -a
# Output: Linux worksync 6.12.47+rpt-rpi-2712 #1 SMP PREEMPT Debian 1:6.12.47-1+rpt1

# Identify Raspberry Pi model
cat /proc/device-tree/model
# Output: Raspberry Pi 5 Model B Rev 1.0

# Check RAM
free -h
# Output: 7.9Gi total

# Check disk space
df -h
# Output: 117G total, 5.6G used

# Check CPU
lscpu | grep -E "Model name|Architecture|CPU\(s\)"
# Output: Cortex-A76, aarch64, 4 CPUs
```

### Software Versions
```bash
# Node.js version
node --version
# Output: v20.19.6

# npm version
npm --version
# Output: 10.8.2

# PostgreSQL version
psql --version
# Output: PostgreSQL 17.7

# Git installed
which git
# Output: /usr/bin/git
```

### Network Configuration
```bash
# Get IP address
hostname -I
# Output: 192.168.1.9

# Check timezone
timedatectl
# Output: Asia/Kolkata (IST, +0530)
```

---

## 2. Directory Structure Setup

### Create Project Directories
```bash
# Create necessary directories
mkdir -p ~/worksync/reports
mkdir -p ~/worksync/qrcodes
mkdir -p ~/worksync/logs
mkdir -p ~/worksync/backups
mkdir -p ~/worksync/scripts

# Verify structure
ls -lah ~/worksync/
```

**Result:** All directories created with correct permissions (worksync:worksync)

---

## 3. PostgreSQL Database Configuration

### Check Available Locales
```bash
locale -a
# Output: C, C.utf8, en_GB.utf8, POSIX
```

### Create Database and User
```bash
# Create database with correct locale
sudo -u postgres psql -c "CREATE DATABASE worksync_db ENCODING 'UTF8' LC_COLLATE='C.utf8' LC_CTYPE='C.utf8' TEMPLATE=template0;"

# User already existed, reset password
sudo -u postgres psql -c "ALTER USER worksync_user WITH ENCRYPTED PASSWORD 'worksync_secure_2026';"

# Grant privileges
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE worksync_db TO worksync_user;"

# Grant schema privileges
sudo -u postgres psql -d worksync_db -c "GRANT ALL ON SCHEMA public TO worksync_user;"
sudo -u postgres psql -d worksync_db -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO worksync_user;"
sudo -u postgres psql -d worksync_db -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO worksync_user;"
```

### Test Database Connection
```bash
# Test connection with credentials
PGPASSWORD='worksync_secure_2026' psql -h 127.0.0.1 -U worksync_user -d worksync_db -c "SELECT current_database(), current_user, version();"
```

**Result:** ✅ Connection successful

---

## 4. PostgreSQL Optimization for Raspberry Pi

### Create Optimization Configuration File
```bash
cat << 'EOF' | sudo tee /etc/postgresql/17/main/conf.d/worksync_optimization.conf
# WorkSync Raspberry Pi Optimization Configuration
# Optimized for 8GB RAM Raspberry Pi 5

# Memory Settings
shared_buffers = 512MB
effective_cache_size = 2GB
maintenance_work_mem = 128MB
work_mem = 16MB

# Connection Settings
max_connections = 20

# Checkpoint Settings (reduce writes, optimize for SSD/SD card)
checkpoint_completion_target = 0.9
wal_buffers = 16MB
min_wal_size = 512MB
max_wal_size = 2GB

# Query Planner (optimized for storage)
random_page_cost = 1.5
effective_io_concurrency = 200

# Logging (for production monitoring)
log_min_duration_statement = 1000
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on

# Autovacuum tuning
autovacuum_max_workers = 2
autovacuum_naptime = 10min
EOF
```

### Restart PostgreSQL to Apply Settings
```bash
# Restart PostgreSQL
sudo systemctl restart postgresql

# Wait for startup
sleep 3

# Verify status
sudo systemctl status postgresql

# Verify new settings
PGPASSWORD='worksync_secure_2026' psql -h 127.0.0.1 -U worksync_user -d worksync_db -c "SHOW shared_buffers; SHOW max_connections; SHOW work_mem;"
```

**Result:**
- shared_buffers: 512MB ✅
- max_connections: 20 ✅
- work_mem: 16MB ✅

---

## 5. Environment Configuration (.env)

### Update .env File
**File:** `/home/worksync/worksync/backend/.env`

```env
# Server Configuration
PORT=3000
NODE_ENV=production
HOST=0.0.0.0

# Database Configuration
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=worksync_db
DB_USER=worksync_user
DB_PASSWORD=worksync_secure_2026

# Security
JWT_SECRET=WorkSync_JWT_Secret_Pi5_Production_2026_SecureKey
JWT_EXPIRY=8h

# File Paths
REPORTS_DIR=/home/worksync/worksync/reports
QRCODES_DIR=/home/worksync/worksync/qrcodes
LOGS_DIR=/home/worksync/worksync/logs
BACKUP_DIR=/home/worksync/worksync/backups

# Shift Configuration
DEFAULT_SHIFT_START=08:00
DEFAULT_SHIFT_END=17:00

# Application Settings
MAX_UPLOAD_SIZE=10mb
RATE_LIMIT_WINDOW=15min
RATE_LIMIT_MAX_REQUESTS=100
```

**Changes Made:**
- Changed NODE_ENV to production
- Updated database name to worksync_db
- Updated database password
- Added JWT secret and expiry
- Added file path configurations
- Added shift time configuration
- Added application settings

---

## 6. Systemd Service Configuration

### Create WorkSync Service
```bash
cat << 'EOF' | sudo tee /etc/systemd/system/worksync.service
[Unit]
Description=WorkSync Factory Production Tracking System
Documentation=https://github.com/worksync/worksync
After=network.target postgresql.service
Requires=postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=worksync
Group=worksync
WorkingDirectory=/home/worksync/worksync/backend
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=worksync

# Environment
Environment="NODE_ENV=production"
EnvironmentFile=/home/worksync/worksync/backend/.env

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/worksync/worksync/reports /home/worksync/worksync/qrcodes /home/worksync/worksync/logs /home/worksync/worksync/backups

# Resource limits
LimitNOFILE=4096
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF
```

### Enable and Configure Service
```bash
# Reload systemd daemon
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable worksync

# Verify service is enabled
systemctl is-enabled worksync
```

**Result:** ✅ Service created and enabled (will auto-start on boot)

---

## 7. Automated Backup System

### Create Daily Backup Script
```bash
cat << 'EOF' > ~/worksync/scripts/daily_backup.sh
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
EOF

# Make executable
chmod +x ~/worksync/scripts/daily_backup.sh
```

### Create Restore Script
```bash
cat << 'EOF' > ~/worksync/scripts/restore_backup.sh
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
EOF

# Make executable
chmod +x ~/worksync/scripts/restore_backup.sh
```

### Schedule Daily Backup via Cron
```bash
# Add cron job for daily backup at 2:00 AM
(crontab -l 2>/dev/null; echo "# WorkSync Daily Backup - Runs at 2:00 AM every day"; echo "0 2 * * * /home/worksync/worksync/scripts/daily_backup.sh") | crontab -

# Verify cron job
crontab -l
```

**Result:** ✅ Cron job scheduled successfully

---

## 8. System Monitoring Script

### Create System Status Script
```bash
cat << 'EOF' > ~/worksync/scripts/system_status.sh
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
EOF

# Make executable
chmod +x ~/worksync/scripts/system_status.sh
```

---

## 9. Verification Tests

### Test Database Connection
```bash
PGPASSWORD='worksync_secure_2026' psql -h 127.0.0.1 -U worksync_user -d worksync_db -c "SELECT 'Database connection test successful' as status, current_database(), current_user, version();"
```

**Result:** ✅ Connection successful, version confirmed

### Check Service Status
```bash
# Check if PostgreSQL is enabled
systemctl is-enabled postgresql
# Output: enabled

# Check if WorkSync service is enabled
systemctl is-enabled worksync
# Output: enabled
```

### Verify npm Dependencies
```bash
cd ~/worksync/backend
npm list --depth=0
```

**Result:** All 12 packages installed:
- bcrypt@6.0.0
- cors@2.8.5
- dotenv@17.2.3
- exceljs@4.4.0
- express@5.2.1
- joi@18.0.2
- jsonwebtoken@9.0.3
- multer@2.0.2
- node-cron@4.2.1
- pg@8.16.3
- qrcode@1.5.4
- winston@3.19.0

### Run System Status Check
```bash
~/worksync/scripts/system_status.sh
```

**Result:** All systems operational except WorkSync service (not started yet - application code needs to be developed)

---

## 10. Final Configuration Summary

### Database
- **Host:** 127.0.0.1
- **Port:** 5432
- **Database:** worksync_db
- **User:** worksync_user
- **Password:** worksync_secure_2026
- **Connection String:** `postgresql://worksync_user:worksync_secure_2026@127.0.0.1:5432/worksync_db`

### Application
- **Port:** 3000
- **Environment:** production
- **Service:** worksync.service
- **Auto-start:** Enabled
- **Working Directory:** /home/worksync/worksync/backend

### Paths
- **Reports:** /home/worksync/worksync/reports
- **QR Codes:** /home/worksync/worksync/qrcodes
- **Logs:** /home/worksync/worksync/logs
- **Backups:** /home/worksync/worksync/backups
- **Scripts:** /home/worksync/worksync/scripts

### Security
- **JWT Secret:** WorkSync_JWT_Secret_Pi5_Production_2026_SecureKey
- **JWT Expiry:** 8 hours
- **Database Auth:** scram-sha-256
- **systemd Hardening:** Enabled

### Backup
- **Schedule:** Daily at 2:00 AM
- **Retention:** 30 days
- **Method:** pg_dump + rsync
- **Log:** /home/worksync/worksync/logs/backup.log

---

## 11. Post-Reboot Verification Commands

After rebooting the Raspberry Pi, run these commands to verify everything is working:

```bash
# 1. Check system status
~/worksync/scripts/system_status.sh

# 2. Verify PostgreSQL is running
sudo systemctl status postgresql

# 3. Verify WorkSync service status
sudo systemctl status worksync

# 4. Test database connection
PGPASSWORD='worksync_secure_2026' psql -h 127.0.0.1 -U worksync_user -d worksync_db -c "SELECT version();"

# 5. Check if port 3000 is listening (once app is running)
sudo lsof -i :3000

# 6. View WorkSync logs
sudo journalctl -u worksync -n 50

# 7. Check disk space
df -h

# 8. Check memory usage
free -h

# 9. Verify cron jobs
crontab -l

# 10. Check network configuration
hostname -I
```

---

## 12. Common Operations Reference

### Starting/Stopping Services
```bash
# Start WorkSync
sudo systemctl start worksync

# Stop WorkSync
sudo systemctl stop worksync

# Restart WorkSync
sudo systemctl restart worksync

# View WorkSync status
sudo systemctl status worksync

# View live logs
sudo journalctl -u worksync -f

# Restart PostgreSQL
sudo systemctl restart postgresql
```

### Backup Operations
```bash
# Run manual backup
~/worksync/scripts/daily_backup.sh

# List available backups
ls -lt ~/worksync/backups/

# Restore from backup
~/worksync/scripts/restore_backup.sh ~/worksync/backups/2026-01-12_020000

# Check backup logs
tail -f ~/worksync/logs/backup.log
```

### Database Operations
```bash
# Connect to database
PGPASSWORD='worksync_secure_2026' psql -h 127.0.0.1 -U worksync_user -d worksync_db

# Check database size
sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size('worksync_db'));"

# List all tables (once created)
PGPASSWORD='worksync_secure_2026' psql -h 127.0.0.1 -U worksync_user -d worksync_db -c "\dt"

# Check active connections
sudo -u postgres psql -c "SELECT * FROM pg_stat_activity WHERE datname='worksync_db';"
```

### System Monitoring
```bash
# System status report
~/worksync/scripts/system_status.sh

# Check CPU/Memory in real-time
htop

# Check disk space
df -h

# Check directory sizes
du -sh ~/worksync/*

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-17-main.log

# Check system logs
sudo journalctl -xe
```

---

## 13. Troubleshooting Guide

### Service Won't Start
```bash
# Check logs
sudo journalctl -u worksync -n 100

# Check if port is already in use
sudo lsof -i :3000

# Check file permissions
ls -la ~/worksync/backend/

# Verify .env file exists
cat ~/worksync/backend/.env

# Test Node.js manually
cd ~/worksync/backend
node src/server.js
```

### Database Connection Issues
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check if database exists
sudo -u postgres psql -c "\l" | grep worksync_db

# Test connection manually
PGPASSWORD='worksync_secure_2026' psql -h 127.0.0.1 -U worksync_user -d worksync_db

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-17-main.log

# Verify pg_hba.conf
sudo cat /etc/postgresql/17/main/pg_hba.conf | grep -v "^#"
```

### Backup Issues
```bash
# Test backup script manually
~/worksync/scripts/daily_backup.sh

# Check backup logs
cat ~/worksync/logs/backup.log

# Verify cron is running
sudo systemctl status cron

# Check cron logs
grep CRON /var/log/syslog | tail -20
```

### Out of Disk Space
```bash
# Check disk usage
df -h

# Find large directories
du -sh ~/worksync/* | sort -h

# Clean old backups manually
find ~/worksync/backups -type d -mtime +30 -exec rm -rf {} \;

# Clean old logs
find ~/worksync/logs -name "*.log" -mtime +90 -delete
```

---

## 14. Security Recommendations

### Production Deployment Checklist

- [ ] Change database password from default
- [ ] Change JWT secret key
- [ ] Enable UFW firewall (optional)
- [ ] Set up SSH key authentication (disable password login)
- [ ] Configure fail2ban for SSH protection
- [ ] Set up automatic security updates
- [ ] Create non-root admin user (already using worksync user ✓)
- [ ] Disable PostgreSQL remote connections (already local only ✓)
- [ ] Set up UPS for power failure protection
- [ ] Configure monitoring/alerting

### Optional Firewall Setup
```bash
# Install UFW
sudo apt install ufw

# Allow SSH
sudo ufw allow 22/tcp

# Allow WorkSync port (only if needed from other devices)
sudo ufw allow 3000/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

---

## 15. Next Development Steps

### Database Schema Design
1. Design tables for all entities
2. Define relationships and foreign keys
3. Create indexes for performance
4. Set up constraints and validation rules

### API Development
1. Create authentication endpoints
2. Build CRUD APIs for all entities
3. Implement production tracking endpoints
4. Develop report generation endpoints
5. Add QR code generation/scanning endpoints

### Testing
1. Unit tests for business logic
2. Integration tests for APIs
3. Load testing for concurrent users
4. Backup/restore testing

---

## 16. Important File Locations

### Configuration Files
- `.env` → `/home/worksync/worksync/backend/.env`
- PostgreSQL config → `/etc/postgresql/17/main/postgresql.conf`
- PostgreSQL optimizations → `/etc/postgresql/17/main/conf.d/worksync_optimization.conf`
- systemd service → `/etc/systemd/system/worksync.service`

### Scripts
- System status → `/home/worksync/worksync/scripts/system_status.sh`
- Daily backup → `/home/worksync/worksync/scripts/daily_backup.sh`
- Restore backup → `/home/worksync/worksync/scripts/restore_backup.sh`

### Logs
- Backup logs → `/home/worksync/worksync/logs/backup.log`
- Application logs → `/home/worksync/worksync/logs/` (when app runs)
- systemd logs → `sudo journalctl -u worksync`
- PostgreSQL logs → `/var/log/postgresql/postgresql-17-main.log`

### Data Directories
- Reports → `/home/worksync/worksync/reports/`
- QR Codes → `/home/worksync/worksync/qrcodes/`
- Backups → `/home/worksync/worksync/backups/`

---

## 17. Contact Information & Resources

### Documentation
- Main setup guide: `~/worksync/RASPBERRY_PI_SETUP.md`
- This session log: `~/worksync/SETUP_SESSION_LOG.md`
- PostgreSQL docs: https://www.postgresql.org/docs/17/
- Node.js docs: https://nodejs.org/docs/
- Express.js docs: https://expressjs.com/

### System Information
- Hostname: worksync
- IP Address: 192.168.1.9
- Access URL: http://192.168.1.9:3000
- SSH: `ssh worksync@192.168.1.9`

---

## Session Completion Summary

✅ **All infrastructure setup tasks completed successfully**

**What's Ready:**
- Raspberry Pi 5 fully configured
- PostgreSQL 17.7 optimized and running
- Node.js environment production-ready
- All dependencies installed
- systemd service configured
- Automated backup system active
- Monitoring scripts in place

**What's Next:**
- Database schema design and creation
- Backend API development
- Frontend UI development
- Testing and deployment

---

## 18. Database Schema Implementation (January 14, 2026)

### Production Lines Table
```sql
CREATE TABLE production_lines (
    id SERIAL PRIMARY KEY,
    line_code VARCHAR(50) NOT NULL UNIQUE,
    line_name VARCHAR(100) NOT NULL,
    hall_location VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    updated_by INTEGER
);

-- Indexes
CREATE INDEX idx_production_lines_code ON production_lines(line_code);
CREATE INDEX idx_production_lines_active ON production_lines(is_active);
```

**Data Imported:** 2 production lines
- RUMIYA_LINE (Hall B) - 105 employees
- GAFOOR_LINE (Hall A) - 37 employees

### Employees Table
```sql
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    emp_code VARCHAR(50) NOT NULL UNIQUE,
    emp_name VARCHAR(100) NOT NULL,
    designation VARCHAR(100),
    default_line_id INTEGER REFERENCES production_lines(id),
    qr_code_path VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    updated_by INTEGER
);

-- Indexes
CREATE INDEX idx_employees_code ON employees(emp_code);
CREATE INDEX idx_employees_line ON employees(default_line_id);
CREATE INDEX idx_employees_active ON employees(is_active);
```

**Data Imported:** 142 employees from EMPLOYEE LIST.xlsx
- Sheet 1 (RUMIYA LINE): 105 employees
- Sheet 2 (GAFOOR LINE): 37 employees
- QR codes generated for all 142 employees

### Products Table
```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(50) NOT NULL UNIQUE,
    product_name VARCHAR(200) NOT NULL,
    product_description TEXT,
    category VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    updated_by INTEGER
);

-- Indexes
CREATE INDEX idx_products_code ON products(product_code);
CREATE INDEX idx_products_active ON products(is_active);
```

**Data Imported:** 1 product
- CY405 (ACCORDION WALLET) - Category: WALLET

### Operations Table (Master Library)
```sql
CREATE TABLE operations (
    id SERIAL PRIMARY KEY,
    operation_code VARCHAR(50) NOT NULL UNIQUE,
    operation_name VARCHAR(200) NOT NULL,
    operation_description TEXT,
    operation_category VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    updated_by INTEGER
);

-- Indexes
CREATE INDEX idx_operations_code ON operations(operation_code);
CREATE INDEX idx_operations_category ON operations(operation_category);
CREATE INDEX idx_operations_active ON operations(is_active);
```

**Data Imported:** 71 operations from GAFOOR LINE.xlsx
- Categories: GENERAL, PASTING, STITCHING, CUTTING, EDGE_INKING, HEATING, PRIMER, EMBOSSING, GRINDING

### Product Processes Table (Process Flow)
```sql
CREATE TABLE product_processes (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    operation_id INTEGER NOT NULL REFERENCES operations(id),
    workspace_id INTEGER REFERENCES workspaces(id),
    sequence_number INTEGER NOT NULL,
    operation_sah DECIMAL(10,4) NOT NULL,
    cycle_time_seconds INTEGER,
    manpower_required INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    updated_by INTEGER,
    CONSTRAINT uq_product_sequence UNIQUE (product_id, sequence_number),
    CONSTRAINT chk_sah_positive CHECK (operation_sah > 0),
    CONSTRAINT chk_sequence_positive CHECK (sequence_number > 0)
);

-- Indexes
CREATE INDEX idx_product_processes_product ON product_processes(product_id);
CREATE INDEX idx_product_processes_operation ON product_processes(operation_id);
CREATE INDEX idx_product_processes_sequence ON product_processes(product_id, sequence_number);
```

**Data Imported:** 71 process steps for CY405 (ACCORDION WALLET)
- Total Cycle Time: 5,371 seconds (~89.5 minutes)
- Total SAH: 1.4928 hours
- All 71 operations linked in sequence

### Workspaces Table (Ready for Future Use)
```sql
CREATE TABLE workspaces (
    id SERIAL PRIMARY KEY,
    workspace_code VARCHAR(50) NOT NULL UNIQUE,
    workspace_name VARCHAR(100) NOT NULL,
    workspace_type VARCHAR(50),
    line_id INTEGER REFERENCES production_lines(id),
    qr_code_path VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    updated_by INTEGER
);

-- Indexes
CREATE INDEX idx_workspaces_code ON workspaces(workspace_code);
CREATE INDEX idx_workspaces_line ON workspaces(line_id);
CREATE INDEX idx_workspaces_active ON workspaces(is_active);
```

**Status:** Table created, awaiting actual workspace/machine list

### Audit Logs Table
```sql
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    record_id INTEGER NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    changed_by INTEGER,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45)
);

-- Indexes
CREATE INDEX idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_record ON audit_logs(record_id);
CREATE INDEX idx_audit_logs_time ON audit_logs(changed_at);
```

---

## 19. QR Code Generation (January 14, 2026)

### Employee QR Codes Generated
```bash
# QR codes stored in: /home/worksync/worksync/qrcodes/employees/
# Format: {emp_code}.png
# Total: 142 QR codes generated

# Example files:
# - LPD00059.png (A. NOORUN)
# - LPD00334.png (R. VASANTHI)
# - LPD00601.png (A. SADIKHA)
# ... (142 total)
```

**QR Code Content Format:**
```json
{
  "type": "employee",
  "code": "LPD00059",
  "name": "A. NOORUN",
  "line": "HALL B RUMIYA LINE"
}
```

---

## 20. Admin Panel Development (January 15, 2026)

### Backend API Routes Created
**File:** `/home/worksync/worksync/backend/src/routes/api.routes.js`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard/stats` | GET | Dashboard statistics |
| `/api/lines` | GET, POST | List/Create production lines |
| `/api/lines/:id` | PUT, DELETE | Update/Deactivate line |
| `/api/employees` | GET, POST | List/Create employees |
| `/api/employees/:id` | GET, PUT, DELETE | Get/Update/Deactivate employee |
| `/api/products` | GET, POST | List/Create products |
| `/api/products/:id` | GET, PUT, DELETE | Get/Update/Deactivate product |
| `/api/operations` | GET, POST | List/Create operations |
| `/api/operations/categories` | GET | Get operation categories |
| `/api/operations/:id` | PUT, DELETE | Update/Deactivate operation |
| `/api/product-processes/:productId` | GET | Get product process flow |
| `/api/product-processes` | POST | Add operation to product |
| `/api/product-processes/:id` | PUT, DELETE | Update/Remove process step |
| `/api/workspaces` | GET, POST | List/Create workspaces |
| `/api/workspaces/:id` | PUT, DELETE | Update/Deactivate workspace |

### Frontend Files Created
**Location:** `/home/worksync/worksync/backend/src/public/`

| File | Description |
|------|-------------|
| `index.html` | Main admin panel HTML (SPA) |
| `css/admin.css` | Modern CSS styling (695 lines) |
| `js/admin.js` | Dynamic JavaScript (1533 lines) |

### Admin Panel Features
1. **Dashboard**
   - Stats cards (Lines, Employees, Products, Operations, Workspaces)
   - Quick action buttons

2. **Production Lines**
   - View all lines with employee counts
   - Add/Edit/Delete lines
   - Active/Inactive status

3. **Employees**
   - View all 142 employees
   - Search by name, code, designation
   - Filter by production line
   - Add/Edit/Delete employees
   - QR code status indicator

4. **Products**
   - View products with operation counts and total SAH
   - Add/Edit/Delete products
   - **Process Flow Management:**
     - View all 71 operations in sequence
     - Add operations from master library
     - Edit cycle time, SAH, manpower
     - Remove operations from flow
     - Auto-calculate SAH from cycle time

5. **Operations Library**
   - View all 71 master operations
   - Filter by category
   - Search operations
   - Add/Edit/Delete operations
   - Track usage across products

6. **Workspaces**
   - Ready for future workspace data
   - Add/Edit/Delete workspaces
   - Link to production lines

### Server Configuration Updated
**File:** `/home/worksync/worksync/backend/src/server.js`

```javascript
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Serve static files (Admin Panel)
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
const apiRoutes = require('./routes/api.routes');
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'WorkSync server is running',
    time: new Date()
  });
});

// Serve admin panel for all other routes
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`WorkSync server running on http://${HOST}:${PORT}`);
  console.log(`Admin Panel: http://localhost:${PORT}`);
});
```

### Package.json Updated
```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "node src/server.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  }
}
```

---

## 21. Database Summary (January 15, 2026)

### Current Data Counts

| Table | Records | Description |
|-------|---------|-------------|
| production_lines | 2 | RUMIYA_LINE, GAFOOR_LINE |
| employees | 142 | All with QR codes |
| products | 1 | CY405 ACCORDION WALLET |
| operations | 71 | Master operation library |
| product_processes | 71 | Complete process flow for CY405 |
| workspaces | 0 | Awaiting data |

### CY405 ACCORDION WALLET - Complete Process Flow

| Seq | Operation | Cycle Time | SAH |
|-----|-----------|------------|-----|
| 1 | E.I PROCESS (STEP & STAMP PKT) | 117s | 0.0325 |
| 2 | 1st patti & step patt with nonwoon pasting | 64s | 0.0178 |
| 3 | stamp & step patti pasting & attaching | 60s | 0.0167 |
| ... | ... (68 more operations) | ... | ... |
| 69 | shapping process | 101s | 0.0281 |
| 70 | cleaning process | 110s | 0.0306 |
| 71 | Quality Analysis | 60s | 0.0167 |

**Totals:**
- Total Operations: 71
- Total Cycle Time: 5,371 seconds (~89.5 minutes)
- Total SAH: 1.4928 hours

---

## 22. Access Information

### Admin Panel URL
- **Local:** http://localhost:3000
- **Network:** http://192.168.1.9:3000

### API Endpoints
- **Base URL:** http://localhost:3000/api
- **Health Check:** http://localhost:3000/health

### Starting the Server
```bash
cd /home/worksync/worksync/backend
npm start
```

### Testing API
```bash
# Dashboard stats
curl http://localhost:3000/api/dashboard/stats

# All employees
curl http://localhost:3000/api/employees

# All products
curl http://localhost:3000/api/products

# Product process flow
curl http://localhost:3000/api/products/1
```

---

## 23. Files Created/Modified Summary

### New Files Created (January 14-15, 2026)

| File | Purpose |
|------|---------|
| `/home/worksync/worksync/backend/src/config/db.config.js` | Database connection pool |
| `/home/worksync/worksync/backend/src/routes/api.routes.js` | All REST API endpoints |
| `/home/worksync/worksync/backend/src/public/index.html` | Admin panel HTML |
| `/home/worksync/worksync/backend/src/public/css/admin.css` | Modern styling |
| `/home/worksync/worksync/backend/src/public/js/admin.js` | Dynamic frontend JS |
| `/home/worksync/worksync/EMPLOYEE_DATABASE_SUMMARY.md` | Employee import documentation |
| `/home/worksync/worksync/PRODUCTS_DATABASE_SUMMARY.md` | Products/Operations documentation |
| `/home/worksync/worksync/qrcodes/employees/*.png` | 142 employee QR codes |

### Modified Files

| File | Changes |
|------|---------|
| `/home/worksync/worksync/backend/src/server.js` | Added static file serving, API routes |
| `/home/worksync/worksync/backend/package.json` | Added start/dev scripts |

---

## Session Updates Summary

### January 12, 2026 - Initial Setup
✅ Raspberry Pi 5 configured
✅ PostgreSQL 17.7 optimized
✅ Node.js environment ready
✅ systemd service created
✅ Backup system configured

### January 14, 2026 - Database & Data Import
✅ Database schema created (6 tables)
✅ 2 production lines imported
✅ 142 employees imported with QR codes
✅ 71 operations imported from Excel
✅ 1 product created with complete process flow

### January 15, 2026 - Admin Panel
✅ REST API endpoints created (15+ endpoints)
✅ Modern admin panel UI created
✅ Dynamic SPA with vanilla JavaScript
✅ Full CRUD for all entities
✅ Process flow management with 71 operations
✅ Search and filter functionality

---

**End of Setup Session Log**
**Last Updated:** January 15, 2026
**Status:** ✅ Infrastructure + Database + Admin Panel Complete

---

## 24. Recent Updates (January 2026)

### Workspace Removal
- Removed Workspaces API routes and dashboard stats (backend)
- Removed Workspaces UI section and dashboard card (admin panel)

### Process Flow Operation Filter
- Added type-to-filter input in "Add Operation" modal
- Filters operation dropdown by prefix match on code or name

### Employee Efficiency Column
- Added Efficiency column to Employees table (UI)
- Added DB migration script: /home/worksync/worksync/scripts/add_employee_efficiency.sql

### QR Code Viewer
- Added "Show QR" button for employees
- Added modal to display employee QR code image
- Served QR code files via /qrcodes static route

### Realtime Updates
- Implemented SSE endpoint (/events) and client auto-refresh
- Added DB LISTEN/NOTIFY listener in backend
- Added DB triggers script: /home/worksync/worksync/scripts/enable_db_notify.sql
- Optimized realtime refresh to reload only affected sections

### Product ↔ Line Linking
- Added line/product linking fields and line metrics
  - Script: /home/worksync/worksync/scripts/add_line_product_fields.sql
- Added line details view: process flow with random employee mapping
- Added line "Details" button and stats (target/efficiency)
- Products now show linked production lines

### Assignment Model Update
- One line → one current product (production_lines.current_product_id)
- One product → many lines (multiple lines can point to same product)
- Product form now uses modern multi-select checkbox cards for line assignment
- Lines view reads current product from production_lines

### Sync Scripts
- One-time sync from product assignments:
  - /home/worksync/worksync/scripts/sync_lines_from_product_assignments.sql

### API Updates
- /api/lines now returns current product from production_lines
- /api/products now returns line_names and line_ids (from production_lines)
- Product create/update now writes line assignments into production_lines

### Services
- Restarted worksync service after updates

### Work Assignments Reset
- Cleared all employee work assignments:
  - `DELETE FROM employee_process_assignments;` (127 rows)

---

## 25. IE Panel, Attendance, and QR Enhancements (January 2026)

### IE Panel
- Added IE page route: `/ie`
- IE uses full admin UI with an additional Attendance section
- Employees section in IE mode hides add/edit/delete actions
- IE Attendance section supports per‑day in/out timing with defaults 08:00–17:00

### Attendance Database
- Added `employee_attendance` table (per‑employee per‑day in/out, status, notes)
- Added API endpoints:
  - `GET /api/ie/attendance?date=YYYY-MM-DD`
  - `POST /api/ie/attendance`

### QR Codes
- Added QR columns:
  - `production_lines.qr_code_path`
  - `product_processes.qr_code_path`
- Added QR generation utility (`backend/src/utils/qr.js`)
- Regenerated QR codes for employees, lines, and processes
- Auto‑generate QR on insert via DB notify listener
- Employee QR payload now includes name + id (replaces older format)

### Employee Work Assignments
- Added line‑specific assignments: `employee_process_assignments` now includes `line_id`
- One employee can be assigned to only one work at a time; assigned employees are disabled globally
- Updated process assignment API to require `line_id`
- Line details now use line+process mapping for assignments

### Real‑time Updates
- IE Attendance listens to `/events` and refreshes on attendance updates
- Updated notify function to use JSONB payloads and include `line_id`

### UI Updates
- Employees table: added serial number column
- Production Lines table: removed Employees column
- Employee QR modal fixed for `qrcodes/...` paths

### Service Reliability
- Service set to always restart with no start‑limit throttling
