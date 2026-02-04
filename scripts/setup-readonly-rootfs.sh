#!/bin/bash
#
# WorkSync SD Card Protection Setup
# Configures Raspberry Pi for read-only root filesystem
# with USB SSD for writable data (database, logs, backups)
#
# This protects the SD card from corruption due to:
# - Power loss
# - Excessive writes
# - SD card wear
#
# Prerequisites:
# - USB SSD connected and formatted (ext4 recommended)
# - Run this script as root (sudo)
#

set -e

echo "=========================================="
echo "  WorkSync SD Card Protection Setup"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Please run as root (use sudo)"
    exit 1
fi

# Configuration
WORKSYNC_USER="worksync"
WORKSYNC_DIR="/home/worksync/worksync"
DATA_MOUNT="/mnt/worksync-data"

echo "This script will:"
echo "  1. Configure overlayfs for read-only root"
echo "  2. Set up USB SSD for writable data"
echo "  3. Move PostgreSQL data to USB SSD"
echo "  4. Move WorkSync data directories to USB SSD"
echo ""

# Detect USB drives
echo "=== Detecting USB Storage ==="
echo ""
lsblk -d -o NAME,SIZE,TYPE,MOUNTPOINT | grep -E "sd[a-z]|nvme"
echo ""

read -p "Enter the USB device name (e.g., sda): " USB_DEVICE

if [ -z "$USB_DEVICE" ]; then
    echo "ERROR: No device specified"
    exit 1
fi

USB_PATH="/dev/${USB_DEVICE}"
USB_PARTITION="${USB_PATH}1"

if [ ! -b "$USB_PATH" ]; then
    echo "ERROR: Device $USB_PATH not found"
    exit 1
fi

echo ""
echo "WARNING: This will format ${USB_PARTITION}!"
echo "All data on ${USB_PARTITION} will be LOST!"
echo ""
read -p "Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

# Step 1: Partition and format USB drive
echo ""
echo "=== Step 1: Formatting USB Drive ==="

# Create partition if needed
if [ ! -b "$USB_PARTITION" ]; then
    echo "Creating partition on $USB_PATH..."
    parted -s "$USB_PATH" mklabel gpt
    parted -s "$USB_PATH" mkpart primary ext4 0% 100%
    sleep 2
fi

# Format partition
echo "Formatting ${USB_PARTITION} as ext4..."
mkfs.ext4 -F -L "worksync-data" "$USB_PARTITION"

# Step 2: Create mount point and configure fstab
echo ""
echo "=== Step 2: Configuring Mount Point ==="

mkdir -p "$DATA_MOUNT"

# Get UUID
USB_UUID=$(blkid -s UUID -o value "$USB_PARTITION")
echo "USB UUID: $USB_UUID"

# Add to fstab if not already present
if ! grep -q "$USB_UUID" /etc/fstab; then
    echo "Adding to /etc/fstab..."
    echo "UUID=$USB_UUID $DATA_MOUNT ext4 defaults,noatime 0 2" >> /etc/fstab
fi

# Mount the drive
mount "$DATA_MOUNT"

# Step 3: Create directory structure on USB
echo ""
echo "=== Step 3: Creating Directory Structure ==="

mkdir -p "$DATA_MOUNT/postgresql"
mkdir -p "$DATA_MOUNT/worksync/reports"
mkdir -p "$DATA_MOUNT/worksync/qrcodes"
mkdir -p "$DATA_MOUNT/worksync/logs"
mkdir -p "$DATA_MOUNT/worksync/backups"
mkdir -p "$DATA_MOUNT/tmp"

# Step 4: Move PostgreSQL data
echo ""
echo "=== Step 4: Moving PostgreSQL Data ==="

systemctl stop postgresql

# Copy PostgreSQL data
if [ -d /var/lib/postgresql ]; then
    echo "Copying PostgreSQL data..."
    rsync -av /var/lib/postgresql/ "$DATA_MOUNT/postgresql/"

    # Update PostgreSQL config
    PG_CONF="/etc/postgresql/17/main/postgresql.conf"
    if [ -f "$PG_CONF" ]; then
        sed -i "s|data_directory = .*|data_directory = '$DATA_MOUNT/postgresql/17/main'|" "$PG_CONF"
    fi
fi

chown -R postgres:postgres "$DATA_MOUNT/postgresql"

# Step 5: Move WorkSync data directories
echo ""
echo "=== Step 5: Moving WorkSync Data ==="

# Copy existing data
for dir in reports qrcodes logs backups; do
    if [ -d "$WORKSYNC_DIR/$dir" ] && [ "$(ls -A $WORKSYNC_DIR/$dir 2>/dev/null)" ]; then
        echo "Copying $dir..."
        rsync -av "$WORKSYNC_DIR/$dir/" "$DATA_MOUNT/worksync/$dir/"
    fi
done

# Set ownership
chown -R "$WORKSYNC_USER:$WORKSYNC_USER" "$DATA_MOUNT/worksync"

# Create symlinks
echo "Creating symlinks..."
for dir in reports qrcodes logs backups; do
    rm -rf "$WORKSYNC_DIR/$dir"
    ln -sf "$DATA_MOUNT/worksync/$dir" "$WORKSYNC_DIR/$dir"
done

# Step 6: Configure tmpfs for temporary files
echo ""
echo "=== Step 6: Configuring tmpfs ==="

# Add tmpfs mounts if not present
if ! grep -q "tmpfs /tmp" /etc/fstab; then
    echo "tmpfs /tmp tmpfs defaults,noatime,nosuid,size=100m 0 0" >> /etc/fstab
fi

if ! grep -q "tmpfs /var/log" /etc/fstab; then
    echo "tmpfs /var/log tmpfs defaults,noatime,nosuid,mode=0755,size=50m 0 0" >> /etc/fstab
fi

# Step 7: Install and configure overlayroot (optional)
echo ""
echo "=== Step 7: Read-Only Root Configuration ==="

# Create script to enable/disable read-only mode
cat > /usr/local/bin/toggle-readonly << 'TOGGLE_EOF'
#!/bin/bash
# Toggle read-only root filesystem

CMDLINE="/boot/firmware/cmdline.txt"

if grep -q "boot=overlay" "$CMDLINE"; then
    echo "Currently: READ-ONLY mode"
    read -p "Switch to READ-WRITE mode? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
        sed -i 's/ boot=overlay//' "$CMDLINE"
        echo "Switched to READ-WRITE. Reboot to apply."
    fi
else
    echo "Currently: READ-WRITE mode"
    read -p "Switch to READ-ONLY mode? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
        sed -i 's/$/ boot=overlay/' "$CMDLINE"
        echo "Switched to READ-ONLY. Reboot to apply."
    fi
fi
TOGGLE_EOF

chmod +x /usr/local/bin/toggle-readonly

# Step 8: Update WorkSync .env
echo ""
echo "=== Step 8: Updating WorkSync Configuration ==="

ENV_FILE="$WORKSYNC_DIR/backend/.env"
if [ -f "$ENV_FILE" ]; then
    # Update paths in .env
    sed -i "s|REPORTS_DIR=.*|REPORTS_DIR=$DATA_MOUNT/worksync/reports|" "$ENV_FILE"
    sed -i "s|LOGS_DIR=.*|LOGS_DIR=$DATA_MOUNT/worksync/logs|" "$ENV_FILE"
    sed -i "s|BACKUP_DIR=.*|BACKUP_DIR=$DATA_MOUNT/worksync/backups|" "$ENV_FILE"
    echo ".env updated with new paths"
fi

# Step 9: Start services
echo ""
echo "=== Step 9: Starting Services ==="

systemctl start postgresql
sleep 3

# Verify PostgreSQL
if systemctl is-active --quiet postgresql; then
    echo "PostgreSQL: Running"
else
    echo "WARNING: PostgreSQL failed to start"
fi

# Restart WorkSync via PM2
if command -v pm2 &> /dev/null; then
    sudo -u "$WORKSYNC_USER" pm2 restart all
    echo "PM2: Restarted"
fi

# Step 10: Summary
echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "Configuration:"
echo "  USB Device:      $USB_PARTITION"
echo "  Mount Point:     $DATA_MOUNT"
echo "  PostgreSQL:      $DATA_MOUNT/postgresql"
echo "  WorkSync Data:   $DATA_MOUNT/worksync"
echo ""
echo "Commands:"
echo "  Enable read-only:   sudo toggle-readonly"
echo "  Check disk usage:   df -h $DATA_MOUNT"
echo "  Check USB health:   sudo smartctl -a $USB_PATH"
echo ""
echo "IMPORTANT:"
echo "  - The root filesystem is still READ-WRITE"
echo "  - Run 'sudo toggle-readonly' to enable read-only mode"
echo "  - Reboot after enabling read-only mode"
echo ""
echo "Note: Before enabling read-only mode, ensure all"
echo "configuration changes are complete!"
echo ""
