#!/bin/bash
#
# WorkSync PM2 Setup Script
# This script sets up PM2 to manage the WorkSync application
#

set -e

WORKSYNC_DIR="/home/worksync/worksync"
BACKEND_DIR="${WORKSYNC_DIR}/backend"
LOG_DIR="${WORKSYNC_DIR}/logs"

echo "=========================================="
echo "  WorkSync PM2 Setup Script"
echo "=========================================="

# Create logs directory
echo "Creating logs directory..."
mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR"

# Stop existing systemd service if running
echo "Stopping existing systemd service..."
sudo systemctl stop worksync 2>/dev/null || true
sudo systemctl disable worksync 2>/dev/null || true

# Delete any existing PM2 processes
echo "Cleaning up existing PM2 processes..."
pm2 delete all 2>/dev/null || true

# Start WorkSync with PM2 using ecosystem config
echo "Starting WorkSync with PM2..."
cd "$BACKEND_DIR"
pm2 start ecosystem.config.js

# Wait for startup
sleep 3

# Check status
echo ""
echo "PM2 Status:"
pm2 status

# Save PM2 process list
echo ""
echo "Saving PM2 process list..."
pm2 save

# Setup PM2 startup script
echo ""
echo "Setting up PM2 startup on boot..."
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u worksync --hp /home/worksync
pm2 save

echo ""
echo "=========================================="
echo "  PM2 Setup Complete!"
echo "=========================================="
echo ""
echo "Useful PM2 commands:"
echo "  pm2 status        - View process status"
echo "  pm2 logs          - View logs (all instances)"
echo "  pm2 logs worksync - View WorkSync logs"
echo "  pm2 monit         - Monitor CPU/Memory"
echo "  pm2 reload all    - Graceful reload (zero downtime)"
echo "  pm2 restart all   - Restart all processes"
echo "  pm2 stop all      - Stop all processes"
echo ""
