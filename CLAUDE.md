# WorkSync — Project Instructions

## Stack
- **Backend**: Node.js (v20) + Express, routes in `backend/src/routes/api.routes.js`
- **Database**: PostgreSQL 17 — DB: `worksync_db`, user: `worksync_user`
- **Frontend**: Vanilla JS — `backend/src/public/js/` (admin.js, supervisor.js, management.js)
- **Server**: systemd service on Raspberry Pi 5 (192.168.1.9)

## Critical Commands
- **Restart server**: `sudo systemctl restart worksync` — always run after backend changes
- **Apply migration**: `PGPASSWORD=worksync_secure_2026 psql -h 127.0.0.1 -U worksync_user -d worksync_db -f <file.sql>`
- **Migrations folder**: `backend/src/migrations/` — applied manually, latest applied: 022

## MCP Usage

### context7 (Live Documentation)
Use when asked to:
- Build or configure anything with Next.js, React, Express, PostgreSQL, Tailwind, shadcn/ui, Prisma, etc.
- Look up correct API signatures, options, or patterns for any library
- Always resolve library docs via context7 before writing code that uses a framework

### postgres (Direct DB Access)
Use when asked to:
- Query the WorkSync database directly (inspect tables, debug data, run reports)
- Check schema, indexes, or row counts without writing a psql command
- Verify migration results or data integrity
- DB: `worksync_db` on `127.0.0.1:5432`

### sequential-thinking (Complex Problem Solving)
Use when asked to:
- Architect a new feature end-to-end (routes + DB + frontend)
- Debug a multi-step issue involving DB, API, and UI layers
- Plan a migration or refactor that touches many files

### stitch (Google Workspace)
Use when asked to:
- Export reports or data to Google Sheets
- Read data from Google Sheets (e.g. import targets, employee lists)
- Access Google Drive or Docs

### @21st-dev/magic (UI Components)
Use when asked to:
- Search for UI component examples or patterns
- Get shadcn/ui, Tailwind, or React component references
- Build or improve frontend UI (admin panel, supervisor panel, reports)

### nano-banana (Gemini AI)
Use when asked to:
- Get Gemini-powered reasoning or analysis
- Perform multimodal/image analysis tasks

## Architecture Notes
- All API routes in one file: `backend/src/routes/api.routes.js` (~5000+ lines)
- Real-time updates via SSE: `realtime.broadcast()`
- Working hours from `app_settings` keys `default_in_time` / `default_out_time`
- QR codes for workstations in `qrcodes/workstations/`

## Key Features (for context)
- **Line Balancing**: Takt-time greedy grouping into workstations; generate via button or Excel upload
- **Supervisor Panel**: Morning (assign employees) + Hourly (enter output per workstation); Regular/OT tabs
- **Changeover**: Triggered at 100% primary target; shares workstation codes between primary and changeover product
- **OT Tracking**: `line_ot_progress` table; per-WS active/inactive, global target, QR employee scan
- **Reports**: OSM Report, Efficiency Report — available in admin, IE, and management views
- **Excel Upload**: `POST /api/lines/plan-upload-excel` — auto-creates line, product, operations, workstation plan in one transaction

## Skills — When to Use

| Skill | Trigger |
|-------|---------|
| `/ui-ux-pro-max` | Designing/improving any frontend page, report layout, component, color, typography |
| `/postgres-pro` | Writing complex queries, optimizing DB, schema design, indexes, migrations |
| `/sql-pro` | SQL queries, joins, aggregations, window functions for reports |
| `/api-designer` | Designing new API endpoints, REST patterns, request/response structure |
| `/javascript-pro` | Vanilla JS frontend work (admin.js, supervisor.js, management.js) |
| `/debugging-wizard` | Diagnosing bugs across DB + API + frontend layers |
| `/code-reviewer` | Reviewing a block of code for quality, correctness, edge cases |
| `/database-optimizer` | Slow queries, missing indexes, query plans, DB performance |
| `/nextjs-developer` | Building any new Next.js frontend or migrating pages to Next.js |
| `/typescript-pro` | Converting JS to TypeScript or writing typed Node.js code |
| `/security-reviewer` | Checking routes/auth for vulnerabilities, SQL injection, XSS, access control |
