#!/bin/bash
#
# Fresh Raspberry Pi bootstrap for WorkSync.
# Installs prerequisites, creates backend/.env, bootstraps PostgreSQL, installs dependencies,
# and registers PM2 with a systemd unit for automatic startup.
#

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
ENV_TEMPLATE="${BACKEND_DIR}/.env.example"
ENV_FILE="${BACKEND_DIR}/.env"
RESTORE_FILE=""
SKIP_PACKAGES="no"
RUN_USER="${SUDO_USER:-$(whoami)}"
RUN_HOME="$(eval echo "~${RUN_USER}")"

usage() {
    cat <<EOF
Usage: $0 [--restore-backup FILE] [--skip-packages]

Options:
  --restore-backup FILE   Restore an existing database backup during setup.
  --skip-packages         Skip apt and npm global package installation.
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --restore-backup)
            RESTORE_FILE="${2:-}"
            shift 2
            ;;
        --skip-packages)
            SKIP_PACKAGES="yes"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

if [ ! -f "$ENV_TEMPLATE" ]; then
    echo "Missing env template: $ENV_TEMPLATE"
    exit 1
fi

if [ "$SKIP_PACKAGES" != "yes" ]; then
    echo "Installing OS packages..."
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl git rsync build-essential postgresql postgresql-client

    NODE_MAJOR="0"
    if command -v node >/dev/null 2>&1; then
        NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
    fi
    if [ "$NODE_MAJOR" -lt 20 ]; then
        echo "Installing Node.js 20..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi

    if ! command -v pm2 >/dev/null 2>&1; then
        echo "Installing PM2..."
        sudo npm install -g pm2
    fi
fi

echo "Creating runtime directories..."
mkdir -p "${ROOT_DIR}/logs" "${ROOT_DIR}/reports" "${ROOT_DIR}/qrcodes" "${ROOT_DIR}/backups"

if [ ! -f "$ENV_FILE" ]; then
    if command -v openssl >/dev/null 2>&1; then
        DB_PASSWORD="$(openssl rand -hex 16)"
        APP_SECRET="$(openssl rand -hex 32)"
    else
        DB_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")"
        APP_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    fi

    sed \
        -e "s|__WORKSYNC_ROOT__|${ROOT_DIR}|g" \
        -e "s|CHANGE_ME_DB_PASSWORD|${DB_PASSWORD}|g" \
        -e "s|CHANGE_ME_LONG_RANDOM_SECRET|${APP_SECRET}|g" \
        "$ENV_TEMPLATE" > "$ENV_FILE"

    echo "Created ${ENV_FILE}"
else
    echo "Using existing ${ENV_FILE}"
fi

echo "Installing backend dependencies..."
(cd "$BACKEND_DIR" && npm ci --omit=dev)

if [ -n "$RESTORE_FILE" ]; then
    "${ROOT_DIR}/scripts/bootstrap-db.sh" --restore "$RESTORE_FILE" --skip-migrate
else
    "${ROOT_DIR}/scripts/bootstrap-db.sh"
fi

echo "Registering PM2 service..."
"${ROOT_DIR}/scripts/setup-pm2.sh"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

echo ""
echo "Fresh Pi setup complete."
echo "Application URL: http://$(hostname -I | awk '{print $1}'):${PORT:-3000}"
echo "System service: worksync-pm2"
echo "Env file: ${ENV_FILE}"
