# WorkSync Overview

## What the system does
WorkSync is a real-time factory production tracking system for line-based manufacturing. It combines:
- Daily planning (product + target by line)
- QR-based attendance and process assignment
- Hourly progress tracking by process
- Material flow tracking (issued, used, forwarded, returned)
- Live dashboards for production, efficiency, and QA
- Excel reporting

It runs on a local server and syncs live to all screens via Server-Sent Events (SSE).

---

## Roles, access, and how they use it

### 1) Admin
**Main goals**
- Master data setup
- Line and system configuration
- Audit and governance

**What Admin can do**
- Create/edit production lines, employees, products, operations
- Configure production days and locks
- Set daily plans (primary + changeover product + target)
- Monitor all dashboards
- Unlock shifts, manage system data

**How**
- Admin panel (`/admin`)
- Daily Plan screen to set product + target for each line
- Line Details for assignments and process flow

---

### 2) IE (Industrial Engineering)
**Main goals**
- Daily planning and targets
- Changeover setup

**What IE can do**
- Set daily plans (primary product + changeover product + target)
- Monitor performance dashboards

**How**
- IE panel (`/ie`) uses the same Daily Plan workflow as Admin

---

### 3) Supervisor
**Main goals**
- Shop floor execution
- Hourly progress entry
- Shift closure

**What Supervisor can do**
- Scan process + employee QR
- Log hourly output by process
- Enter QA rejection for QA operations
- Enter optional hourly remarks
- View live dashboards and shift summary

**How**
- Supervisor panel (`/supervisor`)
- "Hourly Progress" for data entry
- "Shift Summary" for end-of-shift review
- Dashboard includes management snapshot

---

### 4) Management
**Main goals**
- Live performance overview
- Efficiency and output tracking

**What Management can do**
- View line performance, targets vs output
- View employee efficiency (hourly)
- View final stitching / final QA status
- Download reports

**How**
- Management dashboard is embedded into all user dashboards
- Management panel (`/management`) remains for management-only access

---

## Key calculations

### Line Efficiency (%)
```
Efficiency % = ((Actual Output × Total SAH) / (Manpower Count × Working Hours)) × 100
```
Where:
- Actual Output = QA output if available, else total hourly output
- Total SAH = sum of SAH for active operations in the product
- Manpower Count = employees assigned to the line
- Working Hours = configured in settings (default 08:00-17:00)

### Employee Efficiency (%)
Hourly (or shift, depending on view):
```
Efficiency % = ((Output × Operation SAH) / Manpower Factor) × 100
```
Where:
- Output = employee output for the selected hour
- Operation SAH = SAH for the assigned process
- Manpower Factor = employee weight (defaults to 1)

### Completion (%)
```
Completion % = (Actual Output / Target) × 100
```

---

## Changeover model (two products in one line)
During changeover, a line can have two active products:
- **Primary**: outgoing product
- **Incoming**: next product

Progression is automatic:
- IE/Admin set the incoming product.
- Supervisor logs hourly progress.
- When an incoming-product process receives output, the changeover boundary advances automatically.

---

## What each screen displays

### Admin / IE Dashboard (Management Snapshot)
- Line Performance (Target, Output, Efficiency, Completion)
- Employee Efficiency (Hourly)
- Final Stitching / Final QA Status by line

### Supervisor Dashboard (Management Snapshot)
- Same as Admin/IE snapshot

### Supervisor Hourly Progress
- Process output entry
- QA Rejection (for QA operations)
- Optional hourly remarks
- Hourly employee efficiency table (live)

### Shift Summary
- Line info, target, output, efficiency
- Output by process
- Employee output/efficiency
- Materials summary

### Management Panel
- Full dashboard with reports and exports

---

## Live sync behavior
All dashboards refresh live via SSE:
- Daily plan updates sync to line targets and products
- Hourly progress updates sync to efficiency and output
- Changeover boundary advances based on supervisor input

---

## Reports
- Daily and date-range Excel reports are available for management.

---

## Implementation Progress (What’s Done So Far)

### Core platform
- Role-based auth for Admin, IE, Supervisor, Management.
- Real-time sync via SSE for all dashboards.
- Daily plan workflow with line/product/target control.
- Excel export for daily and range reports.

### Changeover (two products on one line)
- Daily plan supports primary + incoming products.
- Changeover boundary tracked by sequence.
- Boundary auto-advances when Supervisor logs hourly progress on incoming product.
- Supervisor can still view/monitor changeover status.

### Dashboards
- Management Snapshot embedded into Admin/IE/Supervisor dashboards.
- Line performance, employee efficiency, and final stitching/QA status live.
- Hourly employee efficiency tables with hour selector and auto-latest hour.

### Supervisor Hourly Progress
- QA rejection input for QA operations.
- Optional hourly remarks per line.
- Hourly employee efficiency live table.

### Lines & Targets
- Line targets sync with Daily Plan targets.
- Line edit no longer allows manual efficiency input.
- Line delete: deactivate or hard-delete (admin-only, only if no related data).

### Security & UX
- Fixed unauthorized access for employee efficiency view.
- Live updates filtered by date/line to reduce unnecessary refreshes.
