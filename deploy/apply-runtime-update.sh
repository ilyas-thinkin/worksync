#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p \
  "${ROOT_DIR}/logs" \
  "${ROOT_DIR}/reports" \
  "${ROOT_DIR}/qrcodes" \
  "${ROOT_DIR}/backups" \
  "${ROOT_DIR}/backend/logs"

if command -v pm2 >/dev/null 2>&1; then
  pm2 save >/dev/null 2>&1 || true
fi

echo "Runtime update applied."
