# WorkSync Factory Production Tracking System - NotebookLM Mindmap Prompt

## Instructions for NotebookLM
Create a comprehensive mindmap for the WorkSync Factory Production Tracking System. This is a web-based application built for garment/apparel manufacturing floors running on Raspberry Pi 5. Organize the information hierarchically with clear branches for each major component.

---

## SYSTEM OVERVIEW

**WorkSync** is a real-time factory production tracking system designed for garment manufacturing. It tracks employee attendance, hourly production output, material flow, and generates efficiency reports.

**Platform**: Raspberry Pi 5 + PostgreSQL + Node.js/Express
**Access**: Web-based responsive application (mobile + desktop)
**Users**: 4 role-based panels (Admin, IE, Supervisor, Management)

---

## USER ROLES & PANELS

### 1. ADMIN PANEL
**Purpose**: Master data management and system configuration

**Features**:
- Production Lines Management (create, edit, delete lines)
- Employee Management (add workers, assign to lines)
- Products Management (styles, SKUs)
- Operations Management (sewing, cutting, finishing operations)
- Process Flow Setup (sequence of operations per product)
- Attendance Overview (view all employee attendance)
- Production Day Lock/Unlock (freeze data for completed days)
- Line Shift Lock/Unlock (close shifts for lines)
- Audit Logs (track all system changes)
- App Settings (working hours, default times)

**Access Level**: Full system control

---

### 2. IE (Industrial Engineering) PANEL
**Purpose**: Production planning and target setting

**Features**:
- Daily Production Plans (assign product to line for a date)
- Target Setting (set daily output targets per line)
- SAH Configuration (Standard Allowed Hours per operation)
- Plan Lock/Unlock (freeze plans after approval)
- View Process Assignments
- Efficiency Monitoring (read-only view of metrics)

**Key Metrics Set by IE**:
- Target Units per day
- Operation SAH values
- Takt Time calculations

**Access Level**: Planning and configuration

---

### 3. SUPERVISOR PANEL
**Purpose**: Shop floor operations and real-time data entry

**Features**:

#### A. Scan & Attendance
- QR Code Scanning (employee ID cards)
- Camera-based QR reader (BarcodeDetector API + jsQR fallback)
- Mark attendance (IN/OUT times)
- Assign employees to processes/operations
- View assigned workers per line

#### B. Hourly Progress Entry
- Record output quantity per hour
- Select process/operation
- Select employee
- Log hourly production data
- View hourly progress log

#### C. Material Tracking
- Issue materials to line
- Record material usage
- Return unused materials
- Forward WIP to next process
- Track Work-in-Progress (WIP) quantities
- Material transaction log

#### D. End-of-Shift Summary
- View daily summary dashboard
- Production metrics display
- Hourly output bar chart
- Employee efficiency list
- Material summary
- Close shift (lock data for the day)

**Access Level**: Operational data entry

---

### 4. MANAGEMENT PANEL
**Purpose**: Performance monitoring and reporting

**Features**:
- Live Dashboard (real-time line metrics)
- Line Performance Table (target vs actual)
- Employee Efficiency View
- Daily Report Download (Excel)
- Date Range Report Download (Excel)
- Cross-line comparison

**Key Metrics Displayed**:
- Active Lines count
- Total Target vs Total Output
- Average Efficiency %
- Completion % per line
- Employee-wise efficiency

**Access Level**: Read-only analytics

---

## DATABASE STRUCTURE & RELATIONSHIPS

### Entity Relationship Overview

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ production_lines│       │    products     │       │   operations    │
│─────────────────│       │─────────────────│       │─────────────────│
│ id (PK)         │       │ id (PK)         │       │ id (PK)         │
│ line_code       │       │ product_code    │       │ operation_code  │
│ line_name       │       │ product_name    │       │ operation_name  │
│ current_product◄├───────┤►id              │       │ category        │
│ target_units    │       │ is_active       │       │ is_active       │
│ is_active       │       └────────┬────────┘       └────────┬────────┘
└────────┬────────┘                │                         │
         │                         │                         │
         │                         ▼                         ▼
         │              ┌─────────────────────────────────────┐
         │              │       product_processes             │
         │              │─────────────────────────────────────│
         │              │ id (PK)                             │
         │              │ product_id (FK) ──► products.id     │
         │              │ operation_id (FK) ► operations.id   │
         │              │ sequence_number                     │
         │              │ operation_sah  ◄── SAH VALUE        │
         │              │ is_active                           │
         │              └──────────────┬──────────────────────┘
         │                             │
         ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    line_daily_plans                          │
│─────────────────────────────────────────────────────────────│
│ id (PK)                                                      │
│ line_id (FK) ──────────────► production_lines.id            │
│ product_id (FK) ───────────► products.id                    │
│ work_date                                                    │
│ target_units  ◄─────────────── DAILY TARGET                 │
│ is_locked                                                    │
└─────────────────────────────────────────────────────────────┘
```

### Complete Table Schema (19 Tables)

#### 1. MASTER DATA TABLES

**production_lines** - Factory sewing/assembly lines
```
id              SERIAL PRIMARY KEY
line_code       VARCHAR(20) UNIQUE      -- e.g., "L01", "L02"
line_name       VARCHAR(100)            -- e.g., "Line 1 - Shirts"
current_product INTEGER REFERENCES products(id)
target_units    INTEGER DEFAULT 0       -- Default daily target
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

**employees** - Factory workers
```
id              SERIAL PRIMARY KEY
emp_code        VARCHAR(20) UNIQUE      -- QR code value, e.g., "EMP001"
emp_name        VARCHAR(100)
department      VARCHAR(50)
designation     VARCHAR(50)
manpower_factor DECIMAL(3,2) DEFAULT 1  -- 1.0 = full worker, 0.5 = half
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMP
```

**products** - Styles/SKUs being manufactured
```
id              SERIAL PRIMARY KEY
product_code    VARCHAR(50) UNIQUE      -- e.g., "SHIRT-BLU-M"
product_name    VARCHAR(200)            -- e.g., "Blue Formal Shirt Medium"
description     TEXT
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMP
```

**operations** - Manufacturing operations
```
id              SERIAL PRIMARY KEY
operation_code  VARCHAR(20) UNIQUE      -- e.g., "SEW-COLLAR"
operation_name  VARCHAR(100)            -- e.g., "Collar Attach"
category        VARCHAR(50)             -- e.g., "Sewing", "Cutting", "Finishing"
is_active       BOOLEAN DEFAULT true
```

**product_processes** - Operation sequence per product with SAH
```
id              SERIAL PRIMARY KEY
product_id      INTEGER REFERENCES products(id)
operation_id    INTEGER REFERENCES operations(id)
sequence_number INTEGER                 -- Order: 1, 2, 3...
operation_sah   DECIMAL(10,6)           -- e.g., 0.0125 hours (45 seconds)
is_active       BOOLEAN DEFAULT true
UNIQUE(product_id, operation_id)
```

**users** - System users for authentication
```
id              SERIAL PRIMARY KEY
username        VARCHAR(50) UNIQUE
full_name       VARCHAR(100)
role            VARCHAR(20)             -- admin, ie, supervisor, management
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMP
```

#### 2. PLANNING TABLES

**line_daily_plans** - Daily production assignments
```
id              SERIAL PRIMARY KEY
line_id         INTEGER REFERENCES production_lines(id)
product_id      INTEGER REFERENCES products(id)
work_date       DATE
target_units    INTEGER                 -- Daily target for this line
is_locked       BOOLEAN DEFAULT false   -- Lock after approval
created_by      INTEGER REFERENCES users(id)
updated_by      INTEGER REFERENCES users(id)
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(line_id, work_date)
```

**production_day_locks** - Lock entire production days
```
id              SERIAL PRIMARY KEY
work_date       DATE UNIQUE
locked_by       INTEGER REFERENCES users(id)
locked_at       TIMESTAMP
```

**line_shift_closures** - Close individual line shifts
```
id              SERIAL PRIMARY KEY
line_id         INTEGER REFERENCES production_lines(id)
work_date       DATE
closed_by       INTEGER REFERENCES users(id)
closed_at       TIMESTAMP
UNIQUE(line_id, work_date)
```

#### 3. ATTENDANCE TABLES

**employee_attendance** - Daily attendance records
```
id              SERIAL PRIMARY KEY
employee_id     INTEGER REFERENCES employees(id)
attendance_date DATE
in_time         TIME                    -- Clock in time
out_time        TIME                    -- Clock out time
status          VARCHAR(20)             -- present, absent, half-day, leave
created_at      TIMESTAMP
UNIQUE(employee_id, attendance_date)
```

**employee_process_assignments** - Current worker-operation mapping
```
id              SERIAL PRIMARY KEY
employee_id     INTEGER REFERENCES employees(id)
line_id         INTEGER REFERENCES production_lines(id)
process_id      INTEGER REFERENCES product_processes(id)
assigned_at     TIMESTAMP
UNIQUE(employee_id, line_id)
```

**process_assignment_history** - Historical assignment records
```
id              SERIAL PRIMARY KEY
employee_id     INTEGER REFERENCES employees(id)
line_id         INTEGER REFERENCES production_lines(id)
process_id      INTEGER REFERENCES product_processes(id)
work_date       DATE
assigned_at     TIMESTAMP
```

#### 4. PRODUCTION TRACKING TABLES

**line_process_hourly_progress** - Hourly output records
```
id              SERIAL PRIMARY KEY
line_id         INTEGER REFERENCES production_lines(id)
process_id      INTEGER REFERENCES product_processes(id)
employee_id     INTEGER REFERENCES employees(id)
work_date       DATE
hour_slot       INTEGER                 -- Hour: 8, 9, 10... 17
quantity        INTEGER                 -- Pieces produced this hour
created_at      TIMESTAMP
UNIQUE(line_id, process_id, employee_id, work_date, hour_slot)
```

**line_daily_metrics** - Aggregated daily metrics per line
```
id              SERIAL PRIMARY KEY
line_id         INTEGER REFERENCES production_lines(id)
work_date       DATE
qa_output       INTEGER DEFAULT 0       -- QA-verified output
forwarded_qty   INTEGER DEFAULT 0       -- Forwarded to next day
remaining_wip   INTEGER DEFAULT 0       -- Work in progress
materials_issued INTEGER DEFAULT 0      -- Materials given
updated_at      TIMESTAMP
UNIQUE(line_id, work_date)
```

#### 5. MATERIAL TRACKING TABLES

**line_material_stock** - Current material inventory per line
```
id              SERIAL PRIMARY KEY
line_id         INTEGER REFERENCES production_lines(id)
material_type   VARCHAR(50)             -- fabric, thread, buttons, etc.
quantity        INTEGER
unit            VARCHAR(20)             -- pcs, meters, kg
updated_at      TIMESTAMP
UNIQUE(line_id, material_type)
```

**material_transactions** - All material movements
```
id              SERIAL PRIMARY KEY
line_id         INTEGER REFERENCES production_lines(id)
process_id      INTEGER REFERENCES product_processes(id)
work_date       DATE
transaction_type VARCHAR(20)            -- issue, use, return, forward
material_type   VARCHAR(50)
quantity        INTEGER
notes           TEXT
created_at      TIMESTAMP
```

**process_material_wip** - WIP per process
```
id              SERIAL PRIMARY KEY
line_id         INTEGER REFERENCES production_lines(id)
process_id      INTEGER REFERENCES product_processes(id)
work_date       DATE
wip_quantity    INTEGER                 -- Current WIP count
updated_at      TIMESTAMP
UNIQUE(line_id, process_id, work_date)
```

#### 6. SYSTEM TABLES

**app_settings** - Application configuration
```
key             VARCHAR(50) PRIMARY KEY -- e.g., "default_in_time"
value           VARCHAR(200)            -- e.g., "08:00"
updated_at      TIMESTAMP
```

**audit_logs** - Change tracking
```
id              SERIAL PRIMARY KEY
table_name      VARCHAR(50)
record_id       INTEGER
action          VARCHAR(20)             -- create, update, delete
old_values      JSONB
new_values      JSONB
created_at      TIMESTAMP
```

---

## HOW DATABASE RELATIONSHIPS WORK

### Data Flow: Product → Process → Tracking

```
1. SETUP (One-time by Admin)
   products ──► product_processes ◄── operations
                     │
                     │ Each product has multiple operations
                     │ with sequence numbers and SAH values
                     ▼
   Example: Product "Blue Shirt" has:
   ├── Seq 1: Collar Attach (SAH: 0.0125)
   ├── Seq 2: Sleeve Attach (SAH: 0.0150)
   ├── Seq 3: Body Join (SAH: 0.0200)
   └── Seq 4: Finishing (SAH: 0.0100)
       Total SAH = 0.0575 hours per piece

2. DAILY PLANNING (By IE)
   production_lines ◄── line_daily_plans ──► products
                              │
                              │ Assigns product to line with target
                              ▼
   Example: Line 1 → Blue Shirt → Target: 500 pcs for 2026-02-02

3. ATTENDANCE (By Supervisor)
   employees ──► employee_attendance
                      │
                      │ Records IN/OUT times
                      ▼
   Example: EMP001 → IN: 08:00, OUT: 17:00, Status: present

4. PROCESS ASSIGNMENT (By Supervisor)
   employees ──► employee_process_assignments ◄── product_processes
                              │
                              │ Links worker to specific operation
                              ▼
   Example: EMP001 → Collar Attach on Line 1

5. HOURLY TRACKING (By Supervisor)
   line_process_hourly_progress
        │
        ├── line_id: Which line
        ├── process_id: Which operation
        ├── employee_id: Who produced
        ├── hour_slot: Which hour (8, 9, 10...)
        └── quantity: How many pieces

   Example: Line 1, Collar Attach, EMP001, Hour 9, Qty: 45

6. AGGREGATION (Automatic)
   line_process_hourly_progress ──► line_daily_metrics
                                         │
                                         │ System sums hourly data
                                         ▼
   Example: Total output = SUM of all hourly quantities
```

### Key Relationships Diagram

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  employees  │────►│ attendance  │     │  products   │
└─────────────┘     └─────────────┘     └──────┬──────┘
       │                                       │
       │                                       ▼
       │            ┌─────────────────────────────────┐
       │            │      product_processes          │
       │            │  (operation sequence + SAH)     │
       │            └─────────────┬───────────────────┘
       │                          │
       ▼                          ▼
┌─────────────────────────────────────────────────────┐
│           employee_process_assignments              │
│     (who works on which operation on which line)    │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│         line_process_hourly_progress                │
│   (actual production data: who, what, when, how many)│
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              CALCULATIONS                           │
│  Efficiency %, Takt Time, Completion %              │
└─────────────────────────────────────────────────────┘
```

---

## DETAILED CALCULATIONS - HOW THEY WORK

### 1. TAKT TIME CALCULATION

**Purpose**: Time allowed per piece to meet daily target

**Formula**:
```
Takt Time (seconds) = Available Working Seconds / Daily Target
```

**Data Sources**:
| Data Needed | Source Table | Field |
|-------------|--------------|-------|
| Working Start Time | app_settings | key='default_in_time', value='08:00' |
| Working End Time | app_settings | key='default_out_time', value='17:00' |
| Daily Target | line_daily_plans | target_units |

**Step-by-Step Calculation**:
```
Step 1: Get working hours from settings
        IN Time = 08:00 (8.0 hours)
        OUT Time = 17:00 (17.0 hours)

Step 2: Calculate available hours
        Working Hours = 17.0 - 8.0 = 9.0 hours

Step 3: Convert to seconds
        Working Seconds = 9.0 × 3600 = 32,400 seconds

Step 4: Get target from daily plan
        Target = 500 pieces

Step 5: Calculate Takt Time
        Takt Time = 32,400 / 500 = 64.8 seconds per piece

Result: Each piece must be completed in 64.8 seconds to meet target
```

**Display Format**: "1m 4s" (1 minute 4 seconds)

---

### 2. LINE EFFICIENCY CALCULATION

**Purpose**: Measure how effectively the line uses available labor hours

**Formula**:
```
Line Efficiency % = (Earned Hours / Available Hours) × 100

Where:
  Earned Hours = Actual Output × Total Product SAH
  Available Hours = Manpower × Working Hours
```

**Data Sources**:
| Data Needed | Source Table | Field/Calculation |
|-------------|--------------|-------------------|
| Actual Output | line_process_hourly_progress | SUM(quantity) for the day |
| Total SAH | product_processes | SUM(operation_sah) for product |
| Manpower | employee_process_assignments | COUNT of assigned employees |
| Working Hours | app_settings | Calculated from in/out time |

**Step-by-Step Calculation**:
```
Step 1: Get actual output
        Query: SELECT SUM(quantity) FROM line_process_hourly_progress
               WHERE line_id = 1 AND work_date = '2026-02-02'
        Result: Actual Output = 450 pieces

Step 2: Get total SAH for the product
        Query: SELECT SUM(operation_sah) FROM product_processes
               WHERE product_id = 1 AND is_active = true
        Result: Total SAH = 0.0575 hours per piece

Step 3: Calculate earned hours
        Earned Hours = 450 × 0.0575 = 25.875 hours

Step 4: Get manpower count
        Query: SELECT COUNT(*) FROM employee_process_assignments
               WHERE line_id = 1
        Result: Manpower = 35 workers

Step 5: Calculate available hours
        Working Hours = 9.0 hours (from settings)
        Available Hours = 35 × 9.0 = 315 hours

Step 6: Calculate efficiency
        Efficiency = (25.875 / 315) × 100 = 8.21%

Wait! This seems low. Let's check...

Actually, if SAH is per piece and includes ALL operations:
        Total SAH = 0.0575 hours = 3.45 minutes per piece

With 35 workers over 9 hours:
        Theoretical max = 315 hours / 0.0575 = 5,478 pieces

Actual 450 pieces = 450 / 5,478 = 8.21% efficiency

Hmm, this indicates the SAH might be just for ONE operation.
Let me recalculate with per-operation SAH:

If average operation SAH = 0.0125 hours (45 seconds):
        Earned Hours = 450 × 0.0125 = 5.625 hours per operation
        With 4 operations: 5.625 × 4 = 22.5 total earned hours

But actually, the formula uses Total Product SAH:
        If Total SAH = 0.5 hours (30 minutes for full garment):
        Earned Hours = 450 × 0.5 = 225 hours
        Efficiency = (225 / 315) × 100 = 71.4%

This makes more sense for garment manufacturing!
```

**Practical Example**:
```
Line: Line 1 - Shirts
Date: 2026-02-02
Product: Blue Formal Shirt
Target: 500 pieces
Actual Output: 450 pieces

Total Product SAH: 0.50 hours (30 minutes per complete shirt)
Manpower: 35 workers
Working Hours: 9 hours

Earned Hours = 450 × 0.50 = 225 hours
Available Hours = 35 × 9 = 315 hours
Efficiency = (225 / 315) × 100 = 71.43%

Interpretation: Line used 71.43% of available labor capacity
```

---

### 3. EMPLOYEE EFFICIENCY CALCULATION

**Purpose**: Measure individual worker performance against standard time

**Formula**:
```
Employee Efficiency % = (Earned Hours / Available Hours) × 100

Where:
  Earned Hours = Employee Output × Operation SAH
  Available Hours = Hours Worked × Manpower Factor
```

**Data Sources**:
| Data Needed | Source Table | Field |
|-------------|--------------|-------|
| Employee Output | line_process_hourly_progress | SUM(quantity) for employee |
| Operation SAH | product_processes | operation_sah for assigned operation |
| Hours Worked | employee_attendance | out_time - in_time |
| Manpower Factor | employees | manpower_factor (default 1.0) |

**Step-by-Step Calculation**:
```
Step 1: Get employee's output for the day
        Query: SELECT SUM(quantity) FROM line_process_hourly_progress
               WHERE employee_id = 101 AND work_date = '2026-02-02'
        Result: Output = 380 pieces

Step 2: Get SAH for employee's assigned operation
        Query: SELECT pp.operation_sah
               FROM employee_process_assignments epa
               JOIN product_processes pp ON epa.process_id = pp.id
               WHERE epa.employee_id = 101
        Result: Operation SAH = 0.0125 hours (45 seconds per piece)

Step 3: Calculate earned hours
        Earned Hours = 380 × 0.0125 = 4.75 hours

Step 4: Get actual hours worked
        Query: SELECT in_time, out_time FROM employee_attendance
               WHERE employee_id = 101 AND attendance_date = '2026-02-02'
        Result: IN = 08:00, OUT = 17:00
        Hours Worked = 17 - 8 = 9 hours

Step 5: Get manpower factor
        Query: SELECT manpower_factor FROM employees WHERE id = 101
        Result: Manpower Factor = 1.0 (full-time worker)

Step 6: Calculate available hours
        Available Hours = 9 × 1.0 = 9 hours

Step 7: Calculate efficiency
        Efficiency = (4.75 / 9) × 100 = 52.78%

Interpretation: Employee achieved 52.78% of standard output rate
```

**Manpower Factor Examples**:
- 1.0 = Full-time skilled worker
- 0.75 = Training worker (expected to be slower)
- 0.5 = Part-time or helper
- 1.25 = Highly skilled (can exceed standard)

---

### 4. COMPLETION PERCENTAGE CALCULATION

**Purpose**: Track progress toward daily target

**Formula**:
```
Completion % = (Actual Output / Target) × 100
```

**Data Sources**:
| Data Needed | Source Table | Field |
|-------------|--------------|-------|
| Actual Output | line_process_hourly_progress | SUM(quantity) |
| Target | line_daily_plans | target_units |

**Step-by-Step Calculation**:
```
Step 1: Get actual output
        Actual Output = 450 pieces

Step 2: Get target
        Target = 500 pieces

Step 3: Calculate completion
        Completion = (450 / 500) × 100 = 90%

Interpretation: Line has completed 90% of daily target
```

**Color Coding in UI**:
- Green (≥100%): Target achieved or exceeded
- Yellow (75-99%): On track
- Orange (50-74%): Behind schedule
- Red (<50%): Significantly behind

---

### 5. TOTAL SAH CALCULATION

**Purpose**: Determine standard time for complete product

**Formula**:
```
Total Product SAH = SUM of all operation SAH values
```

**Data Source**:
```sql
SELECT SUM(operation_sah) as total_sah
FROM product_processes
WHERE product_id = ? AND is_active = true
```

**Example**:
```
Product: Blue Formal Shirt

Operations:
├── 1. Collar Cutting      SAH: 0.0083 hours (30 sec)
├── 2. Collar Attach       SAH: 0.0125 hours (45 sec)
├── 3. Sleeve Cutting      SAH: 0.0100 hours (36 sec)
├── 4. Sleeve Attach       SAH: 0.0167 hours (60 sec)
├── 5. Body Cutting        SAH: 0.0139 hours (50 sec)
├── 6. Body Assembly       SAH: 0.0250 hours (90 sec)
├── 7. Button Attach       SAH: 0.0111 hours (40 sec)
├── 8. Buttonhole          SAH: 0.0083 hours (30 sec)
├── 9. Finishing           SAH: 0.0125 hours (45 sec)
└── 10. Quality Check      SAH: 0.0083 hours (30 sec)
─────────────────────────────────────────────────
Total Product SAH:         0.1266 hours (7.6 minutes)
```

---

### 6. HOURLY OUTPUT AGGREGATION

**Purpose**: Track production progress throughout the day

**Query**:
```sql
SELECT
    hour_slot,
    SUM(quantity) as total_quantity
FROM line_process_hourly_progress
WHERE line_id = ? AND work_date = ?
GROUP BY hour_slot
ORDER BY hour_slot
```

**Example Result**:
```
Hour | Output | Cumulative
─────┼────────┼───────────
  8  |   45   |    45
  9  |   52   |    97
 10  |   48   |   145
 11  |   55   |   200
 12  |   30   |   230  (lunch hour - less output)
 13  |   50   |   280
 14  |   53   |   333
 15  |   51   |   384
 16  |   48   |   432
 17  |   18   |   450  (partial hour)
─────┴────────┴───────────
Total:  450 pieces
```

---

## CALCULATION FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│                    INPUT DATA SOURCES                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │app_settings │  │line_daily_  │  │   product_processes     │ │
│  │             │  │   plans     │  │                         │ │
│  │• in_time    │  │• target     │  │• operation_sah (each)   │ │
│  │• out_time   │  │• product_id │  │• sequence_number        │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                      │               │
│         ▼                ▼                      ▼               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              CALCULATE WORKING HOURS                     │   │
│  │         Working Hours = OUT - IN = 9 hours               │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │                                    │
└────────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TAKT TIME                                    │
│         = (Working Hours × 3600) / Target                       │
│         = (9 × 3600) / 500 = 64.8 seconds                       │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              PRODUCTION DATA COLLECTION                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐    ┌─────────────────────────────────┐   │
│  │employee_attendance│    │ line_process_hourly_progress    │   │
│  │                  │    │                                 │   │
│  │• in_time        │    │• line_id                        │   │
│  │• out_time       │    │• employee_id                    │   │
│  │• hours worked   │    │• hour_slot                      │   │
│  └────────┬─────────┘    │• quantity ◄── ACTUAL OUTPUT    │   │
│           │              └─────────────────┬───────────────┘   │
│           │                               │                     │
│           ▼                               ▼                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │        COUNT MANPOWER + SUM OUTPUT                       │   │
│  │   Manpower = 35 workers                                  │   │
│  │   Actual Output = SUM(quantity) = 450 pieces             │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │                                    │
└────────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EFFICIENCY CALCULATION                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Total SAH = SUM(operation_sah) = 0.50 hours per piece         │
│                                                                 │
│  Earned Hours = Actual Output × Total SAH                       │
│               = 450 × 0.50 = 225 hours                          │
│                                                                 │
│  Available Hours = Manpower × Working Hours                     │
│                  = 35 × 9 = 315 hours                           │
│                                                                 │
│  LINE EFFICIENCY = (225 / 315) × 100 = 71.43%                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    COMPLETION CALCULATION                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  COMPLETION % = (Actual Output / Target) × 100                  │
│               = (450 / 500) × 100 = 90%                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OUTPUT: DASHBOARD METRICS                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │ Target: 500 │ │ Output: 450 │ │ Eff: 71.43% │ │Comp: 90%  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Takt Time: 1m 4s │ Manpower: 35 │ SAH: 0.50 hrs        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## TECHNOLOGY STACK

### Frontend
- HTML5 + CSS3 (Mobile-first responsive)
- Vanilla JavaScript (no frameworks)
- CSS Variables for theming
- BarcodeDetector API for QR scanning
- jsQR library as fallback

### Backend
- Node.js + Express.js
- PostgreSQL 17 database
- Server-Sent Events (SSE) for real-time updates
- ExcelJS for report generation
- JWT-based authentication (cookie)

### Infrastructure
- Raspberry Pi 5 (8GB RAM)
- Raspberry Pi OS (Debian-based)
- systemd service management
- Local network deployment
- Optional HTTPS support

---

## REPORT OUTPUTS

### Daily Report (Excel)
- Line Summary sheet (all lines for the day)
- Employee Efficiency sheet
- Materials sheet
- Hourly Progress sheet

### Range Report (Excel)
- Multi-day line performance
- Aggregated employee efficiency
- Date-wise breakdown

### Report Fields
- Line name/code
- Product code/name
- Target, Output, Efficiency %, Completion %
- Employee details with individual efficiency
- Material transactions

---

## AUTHENTICATION

### Role-Based Access
| Role | Password | Panel Access |
|------|----------|--------------|
| admin | admin1234 | Full system |
| ie | ie1234 | Planning |
| supervisor | sup1234 | Operations |
| management | manage1234 | Reports |

---

## MINDMAP STRUCTURE SUGGESTION

```
WorkSync Factory Production Tracking
│
├── 👥 USER ROLES
│   ├── Admin → Master Data Management
│   ├── IE → Production Planning & Targets
│   ├── Supervisor → Shop Floor Operations
│   └── Management → Reports & Analytics
│
├── 🗄️ DATABASE (19 Tables)
│   ├── Master Data
│   │   ├── production_lines
│   │   ├── employees
│   │   ├── products
│   │   ├── operations
│   │   ├── product_processes (SAH values)
│   │   └── users
│   ├── Planning
│   │   ├── line_daily_plans (targets)
│   │   ├── production_day_locks
│   │   └── line_shift_closures
│   ├── Tracking
│   │   ├── employee_attendance
│   │   ├── employee_process_assignments
│   │   ├── line_process_hourly_progress
│   │   ├── line_daily_metrics
│   │   └── process_assignment_history
│   ├── Materials
│   │   ├── line_material_stock
│   │   ├── material_transactions
│   │   └── process_material_wip
│   └── System
│       ├── app_settings
│       └── audit_logs
│
├── 📊 CALCULATIONS
│   ├── Takt Time
│   │   ├── Input: Working Hours, Target
│   │   └── Formula: (Hours × 3600) / Target
│   ├── Line Efficiency %
│   │   ├── Input: Output, SAH, Manpower, Hours
│   │   └── Formula: (Output × SAH) / (Manpower × Hours) × 100
│   ├── Employee Efficiency %
│   │   ├── Input: Output, Operation SAH, Hours Worked
│   │   └── Formula: (Output × SAH) / Hours × 100
│   ├── Completion %
│   │   ├── Input: Actual Output, Target
│   │   └── Formula: (Output / Target) × 100
│   └── Total SAH
│       └── Formula: SUM of all operation SAH for product
│
├── 🔄 DATA FLOW
│   ├── Morning: IE sets plans → Supervisor marks attendance
│   ├── Production: Hourly output entry → Real-time calculations
│   └── End of Day: Shift summary → Lock data → Generate reports
│
├── 🖥️ TECHNOLOGY
│   ├── Frontend: HTML/CSS/JS (Mobile-first)
│   ├── Backend: Node.js + Express
│   ├── Database: PostgreSQL 17
│   ├── Real-time: Server-Sent Events
│   └── Hardware: Raspberry Pi 5
│
└── 📈 OUTPUTS
    ├── Live Dashboard (real-time metrics)
    ├── Shift Summary (end of day)
    └── Excel Reports (daily/range)
```

---

## END OF PROMPT

Use this document to generate a visual mindmap showing the complete WorkSync system architecture, database relationships, calculation methods, and data flow between components.
