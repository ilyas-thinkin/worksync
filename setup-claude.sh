#!/bin/bash
# ============================================================
# Claude Code Setup — WorkSync
# Run this on any machine to install all MCPs and skills
# Usage: bash setup-claude.sh
# ============================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; exit 1; }

# ── Prerequisites ─────────────────────────────────────────
command -v npx  >/dev/null 2>&1 || err "npx not found — install Node.js first"
command -v git  >/dev/null 2>&1 || err "git not found"
command -v python3 >/dev/null 2>&1 || err "python3 not found"

CLAUDE_DIR="$HOME/.claude"
SKILLS_DIR="$CLAUDE_DIR/skills"
SETTINGS="$CLAUDE_DIR/settings.json"

mkdir -p "$SKILLS_DIR"

# ── 1. Install Skills ──────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Installing Skills"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ui-ux-pro-max (from nextlevelbuilder)
if [ ! -d "$SKILLS_DIR/ui-ux-pro-max" ]; then
  TMP=$(mktemp -d)
  git clone --depth=1 --quiet https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git "$TMP"
  mkdir -p "$SKILLS_DIR/ui-ux-pro-max"
  cp "$TMP/.claude/skills/ui-ux-pro-max/SKILL.md" "$SKILLS_DIR/ui-ux-pro-max/"
  cp -r "$TMP/src/ui-ux-pro-max/data"    "$SKILLS_DIR/ui-ux-pro-max/"
  cp -r "$TMP/src/ui-ux-pro-max/scripts" "$SKILLS_DIR/ui-ux-pro-max/"
  rm -rf "$TMP"
  log "ui-ux-pro-max"
else
  warn "ui-ux-pro-max already installed, skipping"
fi

# All other skills (from Jeffallan/claude-skills)
JEFFALLAN_SKILLS=(
  "postgres-pro"
  "api-designer"
  "javascript-pro"
  "sql-pro"
  "debugging-wizard"
  "code-reviewer"
  "database-optimizer"
  "nextjs-developer"
  "security-reviewer"
  "typescript-pro"
)

NEED_JEFFALLAN=false
for skill in "${JEFFALLAN_SKILLS[@]}"; do
  [ ! -d "$SKILLS_DIR/$skill" ] && NEED_JEFFALLAN=true && break
done

if $NEED_JEFFALLAN; then
  TMP=$(mktemp -d)
  git clone --depth=1 --quiet https://github.com/Jeffallan/claude-skills.git "$TMP"
  for skill in "${JEFFALLAN_SKILLS[@]}"; do
    if [ ! -d "$SKILLS_DIR/$skill" ]; then
      cp -r "$TMP/skills/$skill" "$SKILLS_DIR/"
      log "$skill"
    else
      warn "$skill already installed, skipping"
    fi
  done
  rm -rf "$TMP"
else
  warn "All Jeffallan skills already installed, skipping"
fi

# ── 2. Write settings.json (MCPs) ─────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Configuring MCPs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Merge MCPs into existing settings.json using Python
python3 - <<'PYEOF'
import json, os, sys

settings_path = os.path.expanduser("~/.claude/settings.json")

# Load existing settings or start fresh
if os.path.exists(settings_path):
    with open(settings_path) as f:
        try:
            settings = json.load(f)
        except json.JSONDecodeError:
            settings = {}
else:
    settings = {}

if "mcpServers" not in settings:
    settings["mcpServers"] = {}

mcps = {
    "stitch": {
        "url": "https://stitch.googleapis.com/mcp",
        "type": "http",
        "headers": {
            "Accept": "application/json",
            "X-Goog-Api-Key": "AQ.Ab8RN6I8dyR4F4q2b_-Gd_Biy1Q1WVZTFUwsx0T7-PGuVEQoGQ"
        }
    },
    "nano-banana": {
        "command": "npx",
        "args": ["-y", "-p", "@lyalindotcom/nano-banana-mcp", "nano-banana-server"],
        "env": {
            "GEMINI_API_KEY": "AIzaSyBJHkPBbD8Um-OThyToMN6YpbvCSiAqVxY"
        },
        "timeout": 60000,
        "trust": True
    },
    "@21st-dev/magic": {
        "command": "npx",
        "args": [
            "-y",
            "@21st-dev/magic@latest",
            "API_KEY=23480b73724073d243c7f4de181dc29fddd548cc8ba84df34d2a34e79d3d19a8"
        ]
    },
    "context7": {
        "command": "npx",
        "args": ["-y", "@upstash/context7-mcp@latest"],
        "timeout": 60000,
        "trust": True
    },
    "postgres": {
        "command": "npx",
        "args": [
            "-y",
            "@modelcontextprotocol/server-postgres",
            "postgresql://worksync_user:worksync_secure_2026@127.0.0.1:5432/worksync_db"
        ],
        "timeout": 60000,
        "trust": True
    },
    "sequential-thinking": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
        "timeout": 60000,
        "trust": True
    }
}

# Merge — don't overwrite existing keys unless force
for name, config in mcps.items():
    settings["mcpServers"][name] = config
    print(f"  ✓ {name}")

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)

print(f"\nSettings saved to {settings_path}")
PYEOF

# ── Done ───────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  Setup complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Skills installed in: $SKILLS_DIR"
echo "MCPs configured in:  $SETTINGS"
echo ""
echo "Restart Claude Code for MCPs to take effect."
echo ""
