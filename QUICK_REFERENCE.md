# WorkSync Quick Reference Card

**IP Address:** 192.168.1.9
**Access URL:** http://192.168.1.9:3000
**System:** Raspberry Pi 5 (8GB RAM)

---

## 🚀 Essential Commands

### Service Management
```bash
sudo systemctl start worksync      # Start WorkSync
sudo systemctl stop worksync       # Stop WorkSync
sudo systemctl restart worksync    # Restart WorkSync
sudo systemctl status worksync     # Check status
sudo journalctl -u worksync -f     # View live logs
```

### Quick Status Check
```bash
~/worksync/scripts/system_status.sh
```

### Database Access
```bash
# Connect to database
PGPASSWORD='worksync_secure_2026' psql -h 127.0.0.1 -U worksync_user -d worksync_db

# Check database size
sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size('worksync_db'));"
```

### Backup & Restore
```bash
# Run manual backup
~/worksync/scripts/daily_backup.sh

# List backups
ls -lt ~/worksync/backups/

# Restore from backup
~/worksync/scripts/restore_backup.sh ~/worksync/backups/YYYY-MM-DD_HHMMSS
```

---

## 📁 Important Files

| Purpose | Path |
|---------|------|
| Environment config | `/home/worksync/worksync/backend/.env` |
| Main app | `/home/worksync/worksync/backend/src/server.js` |
| systemd service | `/etc/systemd/system/worksync.service` |
| PostgreSQL config | `/etc/postgresql/17/main/conf.d/worksync_optimization.conf` |
| System status script | `~/worksync/scripts/system_status.sh` |
| Backup script | `~/worksync/scripts/daily_backup.sh` |
| Setup log | `~/worksync/SETUP_SESSION_LOG.md` |
| Setup guide | `~/worksync/RASPBERRY_PI_SETUP.md` |

---

## 🔐 Credentials

**Database:**
- Host: 127.0.0.1
- Port: 5432
- Database: worksync_db
- User: worksync_user
- Password: worksync_secure_2026

**JWT:**
- Secret: WorkSync_JWT_Secret_Pi5_Production_2026_SecureKey
- Expiry: 8h

---

## 📊 System Specs

- **RAM:** 8GB
- **CPU:** 4-core ARM Cortex-A76
- **Storage:** 117GB
- **OS:** Debian GNU/Linux 13
- **Node.js:** v20.19.6
- **PostgreSQL:** 17.7

---

## 🔍 Monitoring

```bash
htop                          # CPU/Memory usage
df -h                         # Disk space
free -h                       # Memory status
sudo systemctl status postgresql  # Database status
sudo systemctl status worksync    # App status
```

---

## 🐛 Troubleshooting

**Service won't start:**
```bash
sudo journalctl -u worksync -n 50
sudo lsof -i :3000
cd ~/worksync/backend && node src/server.js
```

**Database issues:**
```bash
sudo systemctl status postgresql
sudo tail -f /var/log/postgresql/postgresql-17-main.log
```

**Check what's running on port 3000:**
```bash
sudo lsof -i :3000
```

---

## 🕐 Scheduled Tasks

- **Daily Backup:** 2:00 AM (via cron)
- **Backup Retention:** 30 days
- **Auto-start on boot:** Enabled for PostgreSQL and WorkSync

---

## 📞 After Reboot

Everything auto-starts. Verify with:
```bash
~/worksync/scripts/system_status.sh
```

If WorkSync service shows "Not running", start it:
```bash
sudo systemctl start worksync
```

---

**For detailed documentation, see:**
- `~/worksync/RASPBERRY_PI_SETUP.md` (comprehensive guide)
- `~/worksync/SETUP_SESSION_LOG.md` (all commands used during setup)
