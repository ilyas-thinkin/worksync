#!/bin/bash
#
# Bootstrap WorkSync PostgreSQL database on a fresh machine.
# Supports either schema-only initialization or restoring an existing backup.
#

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
ENV_FILE="${BACKEND_DIR}/.env"
SCHEMA_FILE="${BACKEND_DIR}/src/schema.base.sql"
MIGRATION_INDEX_FILE="${BACKEND_DIR}/src/schema.base.migrations"
RESTORE_FILE=""
RUN_MIGRATIONS="yes"
FORCE_RESET="no"

usage() {
    cat <<EOF
Usage: $0 [--restore FILE] [--skip-migrate] [--force-reset]

Options:
  --restore FILE   Restore a database backup (.sql, .sql.gz, or .dump) instead of loading schema.base.sql.
  --skip-migrate   Skip \`npm run migrate\` after bootstrap.
  --force-reset    Drop and recreate the public schema even if the database already has tables.
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --restore)
            RESTORE_FILE="${2:-}"
            shift 2
            ;;
        --skip-migrate)
            RUN_MIGRATIONS="no"
            shift
            ;;
        --force-reset)
            FORCE_RESET="yes"
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

if [ ! -f "$ENV_FILE" ]; then
    echo "Missing ${ENV_FILE}. Create it from backend/.env.example first."
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-worksync_db}"
DB_USER="${DB_USER:-worksync_user}"
DB_PASSWORD="${DB_PASSWORD:-worksync_secure_2026}"

if [ -n "$RESTORE_FILE" ] && [ ! -f "$RESTORE_FILE" ]; then
    echo "Restore file not found: $RESTORE_FILE"
    exit 1
fi

if [ -z "$RESTORE_FILE" ] && [ ! -f "$SCHEMA_FILE" ]; then
    echo "Schema snapshot not found: $SCHEMA_FILE"
    exit 1
fi

sql_escape_literal() {
    printf "%s" "$1" | sed "s/'/''/g"
}

sql_escape_ident() {
    printf "%s" "$1" | sed 's/"/""/g'
}

DB_NAME_SQL="$(sql_escape_literal "$DB_NAME")"
DB_USER_SQL="$(sql_escape_literal "$DB_USER")"
DB_PASSWORD_SQL="$(sql_escape_literal "$DB_PASSWORD")"
DB_NAME_IDENT="$(sql_escape_ident "$DB_NAME")"
DB_USER_IDENT="$(sql_escape_ident "$DB_USER")"

echo "Ensuring PostgreSQL role and database exist..."
sudo -u postgres psql -v ON_ERROR_STOP=1 postgres <<SQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER_SQL}') THEN
        EXECUTE 'CREATE ROLE "${DB_USER_IDENT}" LOGIN PASSWORD ''${DB_PASSWORD_SQL}''';
    ELSE
        EXECUTE 'ALTER ROLE "${DB_USER_IDENT}" WITH LOGIN PASSWORD ''${DB_PASSWORD_SQL}''';
    END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME_SQL}'" | grep -q 1; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 postgres -c "CREATE DATABASE \"${DB_NAME_IDENT}\" OWNER \"${DB_USER_IDENT}\";"
fi

reset_public_schema() {
    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -v ON_ERROR_STOP=1 \
        -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION CURRENT_USER;'
}

database_has_user_tables() {
    local table_count
    table_count="$(
        PGPASSWORD="$DB_PASSWORD" psql \
            -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
            -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" \
            2>/dev/null | xargs
    )"
    [ "${table_count:-0}" -gt 0 ]
}

seed_schema_migrations() {
    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -v ON_ERROR_STOP=1 <<SQL
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

    if [ -f "$MIGRATION_INDEX_FILE" ]; then
        while IFS= read -r migration; do
            [ -z "$migration" ] && continue
            PGPASSWORD="$DB_PASSWORD" psql \
                -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
                -v ON_ERROR_STOP=1 \
                -c "INSERT INTO schema_migrations (filename, applied_at) VALUES ('$(sql_escape_literal "$migration")', NOW()) ON CONFLICT (filename) DO NOTHING;"
        done < "$MIGRATION_INDEX_FILE"
    fi
}

if [ -n "$RESTORE_FILE" ]; then
    echo "Restoring database from ${RESTORE_FILE}..."
    reset_public_schema
    case "$RESTORE_FILE" in
        *.sql.gz)
            gunzip -c "$RESTORE_FILE" | PGPASSWORD="$DB_PASSWORD" psql \
                -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1
            ;;
        *.sql)
            PGPASSWORD="$DB_PASSWORD" psql \
                -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$RESTORE_FILE"
            ;;
        *.dump)
            PGPASSWORD="$DB_PASSWORD" pg_restore \
                -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
                --clean --if-exists --no-owner --no-privileges "$RESTORE_FILE"
            ;;
        *)
            echo "Unsupported restore file format: $RESTORE_FILE"
            exit 1
            ;;
    esac
    echo "Restore complete. Migrations were not auto-applied after restore."
elif database_has_user_tables && [ "$FORCE_RESET" != "yes" ]; then
    echo "Existing tables detected in ${DB_NAME}. Skipping schema reset to preserve current server data."
    echo "If you want to rebuild the database from the repo snapshot, rerun with --force-reset."
else
    echo "Loading base schema snapshot..."
    reset_public_schema
    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -v ON_ERROR_STOP=1 -f "$SCHEMA_FILE"
    seed_schema_migrations
fi

if [ "$RUN_MIGRATIONS" = "yes" ] && [ -z "$RESTORE_FILE" ]; then
    echo "Running migration runner..."
    (cd "$BACKEND_DIR" && npm run migrate)
fi

echo "Database bootstrap complete."
