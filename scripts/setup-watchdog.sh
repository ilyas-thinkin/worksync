#!/bin/bash
#
# WorkSync Raspberry Pi Hardware Watchdog Setup
# Enables the BCM2835 hardware watchdog to auto-reboot on system hang
#
# This script must be run as root/sudo
#

set -e

echo "=========================================="
echo "  Raspberry Pi Hardware Watchdog Setup"
echo "=========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (use sudo)"
    exit 1
fi

# Check if this is a Raspberry Pi
if ! grep -q "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
    echo "Warning: This doesn't appear to be a Raspberry Pi"
    echo "Continuing anyway..."
fi

echo ""
echo "Step 1: Installing watchdog package..."
apt-get update -qq
apt-get install -y watchdog

echo ""
echo "Step 2: Enabling hardware watchdog module..."
# Add bcm2835_wdt to /etc/modules if not already present
if ! grep -q "bcm2835_wdt" /etc/modules; then
    echo "bcm2835_wdt" >> /etc/modules
    echo "  Added bcm2835_wdt to /etc/modules"
else
    echo "  bcm2835_wdt already in /etc/modules"
fi

# Load the module now
modprobe bcm2835_wdt 2>/dev/null || true

echo ""
echo "Step 3: Configuring watchdog..."
# Backup existing config
if [ -f /etc/watchdog.conf ]; then
    cp /etc/watchdog.conf /etc/watchdog.conf.backup
fi

# Create watchdog configuration
cat > /etc/watchdog.conf << 'EOF'
# WorkSync Watchdog Configuration
# Hardware watchdog for Raspberry Pi

# Watchdog device
watchdog-device = /dev/watchdog

# Timeout (seconds before reboot if not kicked)
watchdog-timeout = 15

# Maximum allowed system load (15 min average)
max-load-1 = 24
max-load-5 = 18
max-load-15 = 12

# Memory monitoring (reboot if free memory drops below this)
min-memory = 1

# Ping monitoring (optional - check network connectivity)
# ping = 192.168.1.1

# File monitoring (check if file hasn't been modified)
# file = /var/log/syslog
# change = 300

# Temperature monitoring for Raspberry Pi (in millidegrees)
# Reboot if temperature exceeds 85°C
temperature-sensor = /sys/class/thermal/thermal_zone0/temp
max-temperature = 85000

# Process monitoring - ensure critical processes are running
# pid-file = /var/run/postgresql/15-main.pid

# Log watchdog messages
log-dir = /var/log/watchdog

# Run test binary every interval (optional)
# test-binary = /usr/local/bin/watchdog-test.sh
# test-timeout = 60

# Retry count before reboot
retry-timeout = 60

# Realtime scheduling priority
realtime = yes
priority = 1
EOF

echo "  Watchdog configuration created"

echo ""
echo "Step 4: Creating log directory..."
mkdir -p /var/log/watchdog
chmod 750 /var/log/watchdog

echo ""
echo "Step 5: Enabling and starting watchdog service..."
systemctl enable watchdog
systemctl restart watchdog

# Check status
sleep 2
if systemctl is-active --quiet watchdog; then
    echo "  Watchdog service is running"
else
    echo "  Warning: Watchdog service may not be running"
    systemctl status watchdog --no-pager || true
fi

echo ""
echo "Step 6: Verifying watchdog device..."
if [ -c /dev/watchdog ]; then
    echo "  /dev/watchdog device exists"
else
    echo "  Warning: /dev/watchdog device not found"
fi

echo ""
echo "=========================================="
echo "  Watchdog Setup Complete!"
echo "=========================================="
echo ""
echo "Configuration:"
echo "  - Timeout: 15 seconds"
echo "  - Max load monitoring: enabled"
echo "  - Temperature monitoring: 85°C max"
echo "  - Memory monitoring: enabled"
echo ""
echo "The system will automatically reboot if:"
echo "  - System hangs for 15+ seconds"
echo "  - Load average exceeds thresholds"
echo "  - Temperature exceeds 85°C"
echo "  - Memory critically low"
echo ""
echo "To test (WARNING: will reboot system):"
echo "  echo 1 > /dev/watchdog"
echo ""
echo "To check status:"
echo "  systemctl status watchdog"
echo ""
