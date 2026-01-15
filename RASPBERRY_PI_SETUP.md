# WorkSync Raspberry Pi Setup Summary

**Setup Date:** $(date '+%Y-%m-%d %H:%M:%S')
**Hostname:** $(hostname)
**IP Address:** $(hostname -I | awk '{print $1}')

---

## ✅ System Configuration Complete

### Hardware Detected
- **Model:** Raspberry Pi 5 Model B Rev 1.0
- **RAM:** 8GB
- **CPU:** ARM Cortex-A76 (4 cores)
- **Storage:** 117GB available
- **OS:** Debian GNU/Linux 13 (trixie)
- **Kernel:** 6.12.47+rpt-rpi-2712

---

## ✅ Software Stack Installed

### PostgreSQL Database
- **Version:** PostgreSQL 17.7
- **Database:** worksync_db
- **User:** worksync_user
- **Status:** ✓ Running and enabled on boot
- **Optimizations Applied:**
  - shared_buffers: 512MB
  - effective_cache_size: 2GB
  - max_connections: 20
  - work_mem: 16MB
  - Checkpoint and WAL optimizations for Raspberry Pi

### Node.js Backend
- **Version:** v20.19.6
- **npm Version:** 10.8.2
- **Working Directory:** /home/worksync/worksync/backend
- **Service Status:** Configured via systemd
- **Service Name:** worksync.service

### Dependencies Installed
- bcrypt (password hashing)
- cors (CORS middleware)
- dotenv (environment configuration)
- exceljs (Excel report generation)
- express (web framework)
- joi (validation)
- jsonwebtoken (JWT authentication)
- multer (file uploads)
- node-cron (scheduled tasks)
- pg (PostgreSQL client)
- qrcode (QR code generation)
- winston (logging)

---

## ✅ Directory Structure

```
/home/worksync/worksync/
├── backend/
│   ├── src/
│   │   ├── server.js (main application file)
│   │   └── config/
│   │       ├── app.config.js
│   │       └── db.config.js
│   ├── node_modules/
│   ├── package.json
│   └── .env (production configuration)
├── reports/     (Excel reports storage)
├── qrcodes/     (QR code images)
├── logs/        (application logs)
├── backups/     (database backups)
└── scripts/
    ├── daily_backup.sh
    ├── restore_backup.sh
    └── system_status.sh
```

---

## ✅ Configuration Files

### Environment Variables (.env)
Location: `/home/worksync/worksync/backend/.env`

```
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=worksync_db
DB_USER=worksync_user
DB_PASSWORD=worksync_secure_2026
JWT_SECRET=WorkSync_JWT_Secret_Pi5_Production_2026_SecureKey
JWT_EXPIRY=8h
```

### PostgreSQL Configuration
Location: `/etc/postgresql/17/main/conf.d/worksync_optimization.conf`
- Optimized for 8GB RAM Raspberry Pi 5
- Reduced write frequency for SD card/SSD longevity
- Production logging enabled

---

## ✅ Systemd Service

### Service Configuration
Location: `/etc/systemd/system/worksync.service`

**Status:** Enabled (auto-start on boot)

**Commands:**
```bash
# Start service
sudo systemctl start worksync

# Stop service
sudo systemctl stop worksync

# Restart service
sudo systemctl restart worksync

# Check status
sudo systemctl status worksync

# View logs (live)
sudo journalctl -u worksync -f

# View last 50 lines
sudo journalctl -u worksync -n 50
```

---

## ✅ Backup System

### Automated Daily Backup
**Schedule:** 2:00 AM every day (cron)
**Script:** `~/worksync/scripts/daily_backup.sh`
**Retention:** 30 days

**Backup Contents:**
- PostgreSQL database (worksync_db.dump)
- Excel reports directory
- QR code images directory
- Configuration file (.env.backup)
- Backup manifest

**Manual Backup:**
```bash
~/worksync/scripts/daily_backup.sh
```

### Restore from Backup
```bash
# List available backups
ls -lt ~/worksync/backups/

# Restore from specific backup
~/worksync/scripts/restore_backup.sh ~/worksync/backups/2026-01-12_020000
```

---

## ✅ Network Configuration

### Access URLs
- **Main Application:** http://192.168.1.9:3000
- **Health Check:** http://192.168.1.9:3000/health
- **Local Access:** http://localhost:3000

### Firewall (Optional)
If needed, configure UFW:
```bash
sudo ufw allow 3000/tcp
sudo ufw enable
```

---

## ✅ System Monitoring

### Quick Status Check
```bash
~/worksync/scripts/system_status.sh
```

### Resource Monitoring
```bash
# CPU and memory usage
htop

# Disk usage
df -h

# PostgreSQL connections
sudo -u postgres psql -c "SELECT * FROM pg_stat_activity WHERE datname='worksync_db';"

# Database size
sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size('worksync_db'));"
```

---

## ✅ Security Configuration

### Database Security
- Password authentication enabled (scram-sha-256)
- Connections limited to localhost only
- User permissions restricted to worksync_db only

### Application Security
- JWT-based authentication configured
- CORS middleware enabled
- Password hashing via bcrypt
- Environment variables for sensitive data

### System Security
- systemd service hardening enabled:
  - NoNewPrivileges=true
  - PrivateTmp=true
  - ProtectSystem=strict
  - Memory limit: 1GB

---

## ✅ Performance Tuning

### PostgreSQL Optimizations
- Memory allocation optimized for 8GB RAM
- Connection pool limited to 20 (low concurrency workload)
- WAL and checkpoint settings optimized for write reduction
- Query planner tuned for storage type

### Application Configuration
- Production mode enabled
- Logging configured via winston
- Report generation can run asynchronously via node-cron

---

## 🔄 Next Steps (Development)

1. **Database Schema:**
   - Create database tables (users, employees, products, etc.)
   - Define indexes and constraints
   - Set up foreign key relationships

2. **API Development:**
   - Implement authentication endpoints
   - Create CRUD APIs for all entities
   - Build production tracking endpoints
   - Develop reporting endpoints

3. **Frontend Development:**
   - Build web UI for all user roles
   - Implement QR code scanning interface
   - Create dashboards and reports views

4. **Testing:**
   - Test database connections
   - Verify API endpoints
   - Load testing for concurrent users
   - Backup/restore testing

---

## 📊 System Capacity

### Current Configuration Supports:
- **Concurrent Users:** 10-20 simultaneous connections
- **Production Lines:** 5-10 lines
- **Data Retention:** 5+ years (estimated 500MB database)
- **Report Storage:** Unlimited (depends on disk space)
- **Backup Retention:** 30 days (configurable)

### Performance Expectations:
- API Response Time: < 200ms
- Database Query Time: < 100ms
- Excel Report Generation: 10-30 seconds (async)
- Daily Backup Duration: 1-2 minutes

---

## 🛠️ Maintenance Tasks

### Daily
- Automatic backup at 2:00 AM
- Review application logs for errors

### Weekly
- Check disk space: `df -h`
- Verify backup integrity
- Review system performance

### Monthly
- Update system packages: `sudo apt update && sudo apt upgrade`
- Clean old log files
- Review database size and performance

### Quarterly
- Test backup restoration
- Review security settings
- Update Node.js/npm if needed

---

## 📞 Troubleshooting

### Service Won't Start
```bash
# Check logs
sudo journalctl -u worksync -n 50

# Check if port is in use
sudo lsof -i :3000

# Verify PostgreSQL is running
sudo systemctl status postgresql
```

### Database Connection Failed
```bash
# Test connection manually
PGPASSWORD='worksync_secure_2026' psql -h 127.0.0.1 -U worksync_user -d worksync_db

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-17-main.log
```

### Out of Disk Space
```bash
# Check disk usage
df -h

# Find large files
du -h /home/worksync/worksync | sort -rh | head -20

# Clean old backups manually
rm -rf ~/worksync/backups/2026-01-01_*
```

---

## 📝 Important Notes

1. **Database Password:** Change `worksync_secure_2026` in production
2. **JWT Secret:** Change in .env for production deployment
3. **Firewall:** Consider enabling UFW for additional security
4. **UPS:** Recommended for power failure protection
5. **Storage:** Consider USB SSD for better performance and reliability

---

## ✅ Setup Verification Checklist

- [x] Raspberry Pi 5 detected and running
- [x] PostgreSQL 17.7 installed and optimized
- [x] Node.js 20.19.6 installed
- [x] Database worksync_db created
- [x] Database user worksync_user configured
- [x] All npm dependencies installed
- [x] .env file configured for production
- [x] systemd service created and enabled
- [x] Directory structure created
- [x] Backup scripts configured
- [x] Cron job scheduled for daily backups
- [x] System status script created
- [x] Database connection verified
- [ ] Application schema to be created
- [ ] API endpoints to be developed
- [ ] Frontend UI to be built

---

**Setup completed successfully!**
**System is ready for application development.**

For current system status, run:
```bash
~/worksync/scripts/system_status.sh
```
