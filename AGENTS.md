# WorkSync — Agent Instructions (Codex / all AI assistants)

## Stack
- **Backend**: Node.js v20 + Express, all routes in `backend/src/routes/api.routes.js` (~11,500 lines)
- **Database**: PostgreSQL 17 — DB: `worksync_db`, user: `worksync_user`, host: `127.0.0.1:5432`
- **Frontend**: Vanilla JS — `backend/src/public/js/` (admin.js, supervisor.js, management.js)
- **Server**: systemd service `worksync` on Raspberry Pi 5 (192.168.1.9)

## Critical Commands
- **Restart server**: `sudo systemctl restart worksync` — always run after backend changes
- **Apply migration**: `PGPASSWORD=worksync_secure_2026 psql -h 127.0.0.1 -U worksync_user -d worksync_db -f <file.sql>`
- **Migrations folder**: `backend/src/migrations/` — applied manually, latest applied: 033

## Architecture
- All API routes in one file: `backend/src/routes/api.routes.js`
- Real-time updates via SSE: `realtime.broadcast()` + PostgreSQL LISTEN/NOTIFY
- Roles: admin, supervisor (line leader), ie, management
- Workstation-based model: employees assigned to workstations, not processes
- `employee_workstation_assignments` UNIQUE on (line_id, work_date, workstation_code, is_overtime)

## Key Tables
- `production_lines`, `products`, `operations`, `product_processes` — master data
- `line_daily_plans`, `line_plan_workstations`, `line_plan_workstation_processes` — planning
- `employee_workstation_assignments` — live assignments (is_linked, attendance_start, material_provided)
- `line_ot_plans`, `line_ot_workstations`, `line_ot_progress` — overtime
- `line_process_hourly_progress` — supervisor hourly output entry
- `app_settings` — key/value config (working hours, etc.)

## Key Features
- **Line Balancing**: Takt-time greedy grouping into workstations; generate via button or Excel upload
- **Supervisor Panel**: Morning (link employees to workstations) + Hourly (enter output per WS); Regular/OT tabs
- **Changeover**: Triggered at 100% primary target; co_employee_id stored on line_plan_workstations
- **OT Tracking**: `line_ot_progress` table; per-WS, global target, supervisor-authorized
- **Reports**: OSM Report, Efficiency Report — available in admin, IE, and management views
- **Excel Upload**: `POST /api/lines/plan-upload-excel` — auto-creates product + workstation plan in one transaction

## graphify Knowledge Graph

This project has a graphify knowledge graph at `backend/src/graphify-out/`.

Rules:
- Before answering architecture or codebase questions, read `backend/src/graphify-out/GRAPH_REPORT.md` for god nodes and community structure
- If `backend/src/graphify-out/wiki/index.md` exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update backend/src` from the worksync project root to keep the code graph current
- Use `/graphify backend/src` when you need the full graph workflow over the backend codebase
