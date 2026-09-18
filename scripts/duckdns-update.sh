#!/bin/bash
#
# Keeps the DuckDNS name (PUBLIC_HOST) pointed at this Pi's LAN address.
#
# The public name exists only so browsers get a trusted Let's Encrypt certificate; it resolves
# to the Pi's private IP, which is reachable from the factory LAN only. The Pi takes its address
# from DHCP, so this runs from cron and updates DuckDNS only when the address changes.
#
# Settings: /home/worksync/worksync/certs/duckdns.env (chmod 600, not in git)
#   DUCKDNS_DOMAIN=worksync-kh        # the part before .duckdns.org
#   DUCKDNS_TOKEN=xxxxxxxx-xxxx-...
#
# Cron (every 5 minutes):
#   */5 * * * * /home/worksync/worksync/scripts/duckdns-update.sh >> /home/worksync/worksync/logs/duckdns.log 2>&1
#
# Usage:
#   ./duckdns-update.sh           # update only if the LAN address changed
#   ./duckdns-update.sh --force   # update now
#

set -euo pipefail

ENV_FILE="/home/worksync/worksync/certs/duckdns.env"
STATE_FILE="/home/worksync/worksync/logs/duckdns.last-ip"

# shellcheck source=/dev/null
source "$ENV_FILE"
: "${DUCKDNS_DOMAIN:?DUCKDNS_DOMAIN missing in $ENV_FILE}"
: "${DUCKDNS_TOKEN:?DUCKDNS_TOKEN missing in $ENV_FILE}"

# The source address of the default route: the LAN IP, not the Tailscale one.
LAN_IP="$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
if [[ ! "$LAN_IP" =~ ^(10|172|192)\. ]]; then
    echo "$(date '+%F %T') no private LAN address found (got '${LAN_IP}'), not updating"
    exit 1
fi

if [[ "${1:-}" != "--force" && -f "$STATE_FILE" && "$(cat "$STATE_FILE")" == "$LAN_IP" ]]; then
    exit 0
fi

RESULT="$(curl -fsS --max-time 20 "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=${LAN_IP}")"
if [[ "$RESULT" == "OK" ]]; then
    echo "$LAN_IP" > "$STATE_FILE"
    echo "$(date '+%F %T') ${DUCKDNS_DOMAIN}.duckdns.org -> ${LAN_IP}"
else
    echo "$(date '+%F %T') DuckDNS update failed: ${RESULT}"
    exit 1
fi
