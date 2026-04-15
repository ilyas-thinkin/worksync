#!/bin/bash
#
# WorkSync PM2 Setup Script
# This script sets up PM2 to manage the WorkSync application
#

set -e

WORKSYNC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${WORKSYNC_DIR}/backend"
LOG_DIR="${WORKSYNC_DIR}/logs"
SERVICE_TEMPLATE="${WORKSYNC_DIR}/deploy/systemd/worksync-pm2.service"
SERVICE_NAME="worksync-pm2"
RUN_USER="${SUDO_USER:-$(whoami)}"
RUN_HOME="$(eval echo "~${RUN_USER}")"
PM2_PATH="$(command -v pm2)"

if [ -z "$PM2_PATH" ]; then
    echo "pm2 is not installed. Install it first with: sudo npm install -g pm2"
    exit 1
fi

if [ ! -f "$SERVICE_TEMPLATE" ]; then
    echo "Service template not found: $SERVICE_TEMPLATE"
    exit 1
fi

echo "=========================================="
echo "  WorkSync PM2 Setup Script"
echo "=========================================="

# Create logs directory
echo "Creating logs directory..."
mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR"

# Start WorkSync with PM2 using ecosystem config
echo "Starting WorkSync with PM2..."
cd "$BACKEND_DIR"
pm2 delete worksync 2>/dev/null || true
pm2 start ecosystem.config.js --only worksync

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

# Install systemd unit for PM2 resurrect
echo ""
echo "Installing ${SERVICE_NAME}.service..."
sed \
    -e "s|{{WORKSYNC_USER}}|${RUN_USER}|g" \
    -e "s|{{WORKSYNC_HOME}}|${RUN_HOME}|g" \
    -e "s|{{PM2_PATH}}|${PM2_PATH}|g" \
    "$SERVICE_TEMPLATE" | sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"

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
echo "  sudo systemctl status ${SERVICE_NAME}"
echo ""
