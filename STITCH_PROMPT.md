
## MASTER PROMPT (Full System Overview)

```
Create a modern, responsive factory production tracking web application called "WorkSync" for garment manufacturing. The app should have a clean, professional design with a dark navy (#1a1a2e) and teal (#00d4aa) color scheme with white cards and subtle shadows.

Design Requirements:
- Mobile-first responsive design (works on tablets and phones for factory floor use)
- Large touch-friendly buttons (minimum 48px height) for factory workers wearing gloves
- High contrast text for visibility in bright factory lighting
- Card-based layout with rounded corners (12px)
- Modern sans-serif font (Plus Jakarta Sans or Inter)
- Subtle animations and micro-interactions
- Status indicators using color badges (green=good, yellow=warning, red=critical)

The system has 5 main user interfaces:
1. Login Page - Role-based authentication
2. Admin Panel - User and system management
3. IE (Industrial Engineering) Panel - SMV and line balancing
4. Supervisor Panel - Production floor operations
5. Management Dashboard - Analytics and reports
```

---

## INDIVIDUAL PAGE PROMPTS

### 1. LOGIN PAGE

```
Design a clean, modern login page for a factory management system called "WorkSync".

Layout:
- Centered login card on a gradient background (dark navy to deep purple)
- Company logo at top (factory/gear icon with "WorkSync" text)
- Tagline: "Factory Production Tracking System"

Form Elements:
- Username input field with user icon
- Password input field with lock icon and show/hide toggle
- Role dropdown selector with options: Admin, IE, Supervisor, Management
- "Remember me" checkbox
- Large "Sign In" button (teal color #00d4aa)

Footer:
- "Powered by WorkSync v2.0" text
- Current date/time display

Style:
- Glassmorphism effect on login card
- Subtle floating animation on the card
- Input fields with left icon and focus glow effect
- Mobile responsive - card takes full width on small screens
```

---

### 2. ADMIN PANEL

```
Design an admin dashboard for factory management with a sidebar navigation layout.

Header:
- WorkSync logo on left
- "Admin Panel" title
- User avatar with dropdown (Profile, Logout)
- Notification bell icon

Sidebar Navigation (collapsible on mobile):
- Dashboard (home icon)
- Users (people icon)
- Production Lines (layers icon)
- Processes (settings icon)
- Employees (id-card icon)
- Settings (gear icon)

Main Content - Dashboard View:
- Welcome message with admin name
- 4 stat cards in a row:
  * Total Users (with count)
  * Active Lines (with count)
  * Total Employees (with count)
  * Today's Output (with count)

Users Management Section:
- "Add New User" button (top right, teal color)
- Search bar with filter dropdown
- Data table with columns: ID, Username, Role, Status, Actions
- Action buttons: Edit (blue), Delete (red)
- Pagination controls at bottom

Add User Modal:
- Username input
- Password input
- Role dropdown (Admin, IE, Supervisor, Management)
- Line assignment multi-select
- Cancel and Save buttons

Style:
- White cards with subtle shadows
- Alternating row colors in tables
- Status badges (Active=green, Inactive=gray)
- Responsive grid that stacks on mobile
```

---

### 3. IE (INDUSTRIAL ENGINEERING) PANEL

```
Design an Industrial Engineering panel for managing garment production standards.

Header:
- WorkSync logo
- "IE Panel - Production Standards" title
- Line selector dropdown
- User menu

Tab Navigation:
- SMV Management
- Line Balancing
- Target Setting
- Reports

SMV Management Tab:
- "Add New SMV" button
- Filter bar: Style dropdown, Operation search
- SMV table with columns:
  * Style Name
  * Operation Name
  * SMV Value (seconds)
  * Pieces Per Hour
  * Last Updated
  * Actions (Edit, Delete)

Add/Edit SMV Modal:
- Style dropdown (searchable)
- Operation name input
- SMV value input (number with decimals)
- Automatic PPH calculation display
- Notes textarea
- Save/Cancel buttons

Line Balancing Section:
- Visual diagram showing production line layout
- Process boxes connected with arrows
- Each box shows:
  * Process name
  * Operator count
  * Current efficiency %
  * Color coded (green >85%, yellow 70-85%, red <70%)
- Drag and drop to reorder processes
- "Save Layout" button

Target Setting Card:
- Line selector
- Shift selector (Day/Night)
- Working hours input
- SMV value display
- Calculated target output (large number)
- "Apply Target" button

Style:
- Clean data tables with sorting indicators
- Visual flow diagram for line balancing
- Number inputs with increment/decrement buttons
- Color-coded efficiency indicators
```

---

### 4. SUPERVISOR PANEL (Most Important - Mobile First)

```
Design a mobile-first supervisor panel for factory floor production tracking with QR scanning.

Header (sticky):
- Hamburger menu (mobile)
- "Supervisor Panel" title
- Line indicator badge
- Shift status (Day/Night with icon)
- Current time display

Bottom Navigation (mobile):
- Scan (QR icon) - primary action
- Dashboard (chart icon)
- Materials (box icon)
- Summary (clipboard icon)

SCAN SECTION (Primary View):
- Large heading: "Production Tracking"
- Current style/order info card
- Two large scan buttons:
  * "Scan Process QR" (teal, with QR icon)
  * "Scan Employee QR" (blue, with person icon)
- Camera viewfinder area (16:9 ratio, rounded corners)
- Last scan result display card
- Manual entry fallback link

Active Tracking Card:
- Process name (large text)
- Employee name and ID
- Bundle size selector (1-20 pieces)
- Defect toggle with count input
- Large "SUBMIT OUTPUT" button (green)
- Cancel button (gray)

DASHBOARD SECTION:
- Today's date header
- Summary stats row:
  * Target: 1,200
  * Actual: 856
  * Efficiency: 71.3%
  * Completion: 71%
- Circular progress chart (completion %)
- Hourly output bar chart (8 bars for 8 hours)
- Process-wise output table:
  * Process name
  * Target
  * Actual
  * Efficiency % with color badge

MATERIALS SECTION:
- "Record Material Transaction" card:
  * Transaction type toggle: IN / OUT
  * Process dropdown
  * Quantity input (large number pad friendly)
  * Notes input
  * Submit button
- Current Stock by Process:
  * Accordion list of processes
  * Each shows: Input, Output, WIP count
  * Color coded WIP status
- Material history table (recent transactions)

SHIFT SUMMARY SECTION:
- Shift info header (Line, Date, Shift type)
- Performance metrics cards:
  * Total Output (large number)
  * Efficiency % (with gauge)
  * SAH Earned
  * Defect Rate %
- Operator performance table:
  * Employee name
  * Process
  * Output count
  * Efficiency %
  * Ranking badge (1st, 2nd, 3rd)
- "Close Shift" button (red, with confirmation)
- Export to Excel button

Style:
- Extra large touch targets (56px minimum)
- High contrast colors
- Bold numbers for quick reading
- Swipe gestures for navigation
- Pull to refresh indicator
- Loading skeletons for data
- Success/error toast notifications
- Bottom sheet modals instead of popups
```

---

### 5. MANAGEMENT DASHBOARD

```
Design an executive management dashboard for factory analytics and reporting.

Header:
- WorkSync logo
- "Management Dashboard" title
- Date range picker (Today, This Week, This Month, Custom)
- Factory/Line filter dropdown
- Export button
- User menu

KPI Cards Row (4 cards):
1. Total Output
   - Large number (e.g., "12,456")
   - Trend arrow with % change
   - Sparkline mini chart

2. Overall Efficiency
   - Percentage with gauge visual
   - Target line indicator
   - Color coded (green if above target)

3. Active Lines
   - Count with status breakdown
   - Mini donut chart (running/idle)

4. Defect Rate
   - Percentage (should be low)
   - Target comparison
   - Trend indicator

LIVE PRODUCTION SECTION:
- Real-time updating indicator (pulsing dot)
- Line status cards grid:
  * Each card shows line name
  * Current output vs target
  * Progress bar
  * Efficiency %
  * Status badge (Running/Break/Stopped)
  * Last update timestamp
- Auto-refresh every 30 seconds

CHARTS SECTION (2x2 grid):
1. Hourly Output Trend (Line chart)
   - X-axis: Hours (8AM-5PM)
   - Y-axis: Output count
   - Multiple lines for different production lines
   - Target line (dashed)

2. Efficiency by Line (Bar chart)
   - Horizontal bars
   - Sorted by efficiency
   - Color gradient (red to green)
   - Target line marker

3. Weekly Comparison (Grouped bar chart)
   - Days of week
   - This week vs last week
   - Output counts

4. Defect Pareto (Bar + Line chart)
   - Defect types on X-axis
   - Count bars
   - Cumulative % line

REPORTS SECTION:
- Report type selector:
  * Daily Production Report
  * Efficiency Report
  * Operator Performance
  * Material Usage
  * Defect Analysis
- Filter options based on report type
- Preview table
- Download buttons (Excel, PDF)
- Schedule report option

ALERTS PANEL (Sidebar or collapsible):
- Critical alerts (red)
  * "Line 3 efficiency below 60%"
  * "Material shortage on Line 1"
- Warnings (yellow)
  * "Line 2 behind target by 15%"
- Info (blue)
  * "Shift change in 30 minutes"

Style:
- Professional, executive look
- Subtle gradients on cards
- Smooth chart animations
- Hover states with detailed tooltips
- Print-friendly layout option
- Dark mode toggle
- Responsive: charts stack on tablet/mobile
```

---

## COLOR PALETTE

```
Primary Colors:
- Dark Navy: #1a1a2e (backgrounds, headers)
- Teal/Cyan: #00d4aa (primary actions, accents)
- White: #ffffff (cards, content areas)

Secondary Colors:
- Light Gray: #f5f7fa (page backgrounds)
- Medium Gray: #e2e8f0 (borders, dividers)
- Dark Gray: #64748b (secondary text)
- Black: #0f172a (primary text)

Status Colors:
- Success Green: #22c55e (good performance, completed)
- Warning Yellow: #f59e0b (attention needed)
- Error Red: #ef4444 (critical, errors)
- Info Blue: #3b82f6 (information, links)

Efficiency Color Scale:
- 90%+: #22c55e (green)
- 80-89%: #84cc16 (lime)
- 70-79%: #f59e0b (yellow)
- 60-69%: #f97316 (orange)
- Below 60%: #ef4444 (red)
```

---

## COMPONENT SPECIFICATIONS

```
Buttons:
- Primary: Teal background, white text, 12px radius, 48px height
- Secondary: White background, gray border, dark text
- Danger: Red background, white text
- Ghost: Transparent, teal text

Input Fields:
- 48px height for touch
- Left icon option
- Focus state: teal border glow
- Error state: red border with message below

Cards:
- White background
- 12px border radius
- Subtle shadow: 0 2px 8px rgba(0,0,0,0.08)
- 24px padding

Tables:
- Header: light gray background
- Alternating row colors
- Hover state: light teal background
- Sticky header on scroll

Badges/Pills:
- Small: 20px height
- Medium: 28px height
- Rounded full
- Color coded by status

Charts:
- Consistent color palette
- Tooltips on hover
- Legend below or to the right
- Responsive sizing
```

---

## RESPONSIVE BREAKPOINTS

```
Mobile: 320px - 767px
- Single column layout
- Bottom navigation
- Collapsible sections
- Full-width cards
- Hamburger menu

Tablet: 768px - 1023px
- Two column grid where appropriate
- Side navigation (collapsible)
- Compact header

Desktop: 1024px+
- Full sidebar navigation
- Multi-column dashboards
- Expanded data tables
- Side-by-side comparisons
```

---

## USAGE TIPS FOR STITCH

1. **Start with Mobile**: Generate the supervisor panel first as it's the most used on factory floor
2. **Iterate**: Use "Refine" feature to adjust specific sections
3. **Export to Figma**: Fine-tune details in Figma before exporting code
4. **Export HTML/CSS**: Get production-ready code for integration
5. **Component Library**: Generate individual components separately for consistency

---

## SAMPLE PROMPT FOR QUICK START

Copy this into Stitch for a quick prototype:

```
Create a mobile-first factory production tracking app called WorkSync.

Design a supervisor dashboard with:
- Dark navy header with teal accents
- Large QR scan button in the center
- Today's production stats: Target 1200, Actual 856, Efficiency 71%
- Hourly output bar chart
- Bottom navigation with: Scan, Dashboard, Materials, Summary tabs

Style: Modern, clean, high contrast for factory use. Large touch targets. Card-based layout with rounded corners and subtle shadows.
```

---

## SYSTEM ARCHITECTURE & DATA FLOW

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WorkSync System Architecture                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────┐          │
│  │  Admin   │    │    IE    │    │Supervisor│    │  Management  │          │
│  │  Panel   │    │  Panel   │    │  Panel   │    │  Dashboard   │          │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘    └──────┬───────┘          │
│       │               │               │                  │                   │
│       └───────────────┴───────┬───────┴──────────────────┘                   │
│                               │                                              │
│                      ┌────────▼────────┐                                     │
│                      │   REST API      │                                     │
│                      │   (Express.js)  │                                     │
│                      └────────┬────────┘                                     │
│                               │                                              │
│               ┌───────────────┼───────────────┐                              │
│               │               │               │                              │
│        ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐                      │
│        │ PostgreSQL  │ │    SSE      │ │   QR Code   │                      │
│        │  Database   │ │  Real-time  │ │  Generator  │                      │
│        └─────────────┘ └─────────────┘ └─────────────┘                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## USER ROLES & WORKFLOWS

### Role Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER ROLES                                │
├──────────────┬──────────────┬──────────────┬───────────────────┤
│    ADMIN     │      IE      │  SUPERVISOR  │    MANAGEMENT     │
├──────────────┼──────────────┼──────────────┼───────────────────┤
│ Full access  │ Planning &   │ Execution &  │ View-only         │
│ to all       │ standards    │ tracking     │ analytics &       │
│ modules      │ management   │ on floor     │ reports           │
├──────────────┼──────────────┼──────────────┼───────────────────┤
│ • Users      │ • Attendance │ • QR Scan    │ • Line Dashboard  │
│ • Lines      │ • Daily Plan │ • Hourly     │ • Employee        │
│ • Employees  │ • SMV/SAH    │   Progress   │   Efficiency      │
│ • Products   │ • Targets    │ • Materials  │ • Reports         │
│ • Operations │ • Working    │ • Employee   │ • Excel Export    │
│ • Day Locks  │   Hours      │   Assignment │                   │
│ • Audit Logs │              │ • Shift      │                   │
│              │              │   Summary    │                   │
└──────────────┴──────────────┴──────────────┴───────────────────┘
```

---

### WORKFLOW 1: Daily Planning (IE Role)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DAILY PLANNING WORKFLOW                              │
│                              (IE Role)                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MORNING (Before Shift Start - 07:30 AM)                                    │
│  ═══════════════════════════════════════                                    │
│                                                                              │
│  1. LOGIN → IE Panel                                                         │
│       │                                                                      │
│       ▼                                                                      │
│  2. SET DEFAULT WORKING HOURS (if needed)                                    │
│       │  • Default In: 08:00                                                 │
│       │  • Default Out: 17:00                                                │
│       ▼                                                                      │
│  3. CREATE DAILY PLAN (for each line)                                        │
│       │  • Select Line                                                       │
│       │  • Select Product/Style                                              │
│       │  • Set Daily Target                                                  │
│       │  • System calculates: Takt Time, Required Efficiency                 │
│       ▼                                                                      │
│  4. MARK ATTENDANCE                                                          │
│       │  • Review employee list                                              │
│       │  • Mark Present/Absent/Half-day                                      │
│       │  • Adjust in/out times if different from default                     │
│       ▼                                                                      │
│  5. LOCK DAILY PLAN (optional)                                               │
│       │  • Prevents changes to process flow                                  │
│       │  • Ensures SAH values remain fixed for the day                       │
│       ▼                                                                      │
│  ✓ READY FOR PRODUCTION                                                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### WORKFLOW 2: Production Execution (Supervisor Role)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PRODUCTION EXECUTION WORKFLOW                           │
│                           (Supervisor Role)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  SHIFT START (08:00 AM)                                                     │
│  ══════════════════════                                                     │
│                                                                              │
│  1. LOGIN → Supervisor Panel                                                 │
│       │  • Select Production Line                                            │
│       ▼                                                                      │
│  2. RECORD LINE METRICS                                                      │
│       │  • Forwarded Quantity (from previous day)                            │
│       │  • Remaining WIP                                                     │
│       │  • Materials Issued                                                  │
│       ▼                                                                      │
│  3. ASSIGN EMPLOYEES TO PROCESSES                                            │
│       │  • Scan Process QR Code                                              │
│       │  • Scan Employee QR Code                                             │
│       │  • System links employee → process                                   │
│       │  • Record materials at workstation                                   │
│       │                                                                      │
│  DURING SHIFT (Hourly)                                                      │
│  ═════════════════════                                                      │
│       ▼                                                                      │
│  4. RECORD HOURLY PROGRESS (Every Hour: 08, 09, 10... 17, 18, 19)           │
│       │  • Scan Process QR                                                   │
│       │  • Enter completed quantity                                          │
│       │  • Enter forwarded quantity (to next process)                        │
│       │  • Enter remaining WIP                                               │
│       │  • Validation: Completed = Forwarded + Remaining                     │
│       │                                                                      │
│  EMPLOYEE CHANGE (When needed)                                              │
│  ═════════════════════════════                                              │
│       ▼                                                                      │
│  5. CHANGE EMPLOYEE AT PROCESS                                               │
│       │  • Scan Process QR                                                   │
│       │  • Enter quantity completed by outgoing employee                     │
│       │  • Record materials at handover                                      │
│       │  • Scan New Employee QR                                              │
│       │  • System logs history with timestamps                               │
│       │                                                                      │
│  SHIFT END (17:00+)                                                         │
│  ═════════════════                                                          │
│       ▼                                                                      │
│  6. RECORD QA OUTPUT                                                         │
│       │  • Enter final QA-verified output                                    │
│       │  • This is the official production number                            │
│       ▼                                                                      │
│  7. REVIEW SHIFT SUMMARY                                                     │
│       │  • Total Output                                                      │
│       │  • Line Efficiency                                                   │
│       │  • Employee Performance Rankings                                     │
│       │  • SAH Earned                                                        │
│       ▼                                                                      │
│  8. CLOSE SHIFT                                                              │
│       │  • Locks all data for the day                                        │
│       │  • Generates final reports                                           │
│       ▼                                                                      │
│  ✓ SHIFT COMPLETE                                                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### WORKFLOW 3: QR Scanning Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           QR SCANNING WORKFLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐                                                         │
│  │ Supervisor taps │                                                         │
│  │ "Scan Process"  │                                                         │
│  └────────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐     ┌─────────────────┐                                │
│  │ Camera Opens    │────▶│ Scan Process QR │                                │
│  │ (HTTPS required)│     │ Code            │                                │
│  └─────────────────┘     └────────┬────────┘                                │
│                                   │                                          │
│                                   ▼                                          │
│                    ┌──────────────────────────┐                              │
│                    │ QR Payload:              │                              │
│                    │ {                        │                              │
│                    │   "type": "process",     │                              │
│                    │   "id": 45,              │                              │
│                    │   "code": "PROC-045",    │                              │
│                    │   "name": "Stitching"    │                              │
│                    │ }                        │                              │
│                    └───────────┬──────────────┘                              │
│                                │                                             │
│                                ▼                                             │
│           ┌────────────────────────────────────────┐                        │
│           │ System identifies process and shows:   │                        │
│           │ • Process Name                         │                        │
│           │ • Current employee (if any)            │                        │
│           │ • Hourly target                        │                        │
│           └────────────────────┬───────────────────┘                        │
│                                │                                             │
│           ┌────────────────────┴───────────────────┐                        │
│           │                                        │                        │
│           ▼                                        ▼                        │
│  ┌─────────────────┐                    ┌─────────────────┐                 │
│  │ LOG PROGRESS    │                    │ ASSIGN EMPLOYEE │                 │
│  │ • Enter qty     │                    │ • Scan Emp QR   │                 │
│  │ • Forwarded     │                    │ • Link to       │                 │
│  │ • Remaining     │                    │   process       │                 │
│  └─────────────────┘                    └─────────────────┘                 │
│                                                                              │
│  EMPLOYEE QR PAYLOAD:                                                        │
│  {                                                                           │
│    "type": "employee",                                                       │
│    "id": 123,                                                                │
│    "code": "LPD00059",                                                       │
│    "name": "A. NOORUN"                                                       │
│  }                                                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### WORKFLOW 4: Material Tracking Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MATERIAL TRACKING WORKFLOW                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MATERIAL IN (Receiving)                                                    │
│  ═══════════════════════                                                    │
│                                                                              │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐                  │
│  │ Materials   │─────▶│ Record IN   │─────▶│ Update      │                  │
│  │ Arrive at   │      │ transaction │      │ Line Stock  │                  │
│  │ Line        │      │ (quantity)  │      │             │                  │
│  └─────────────┘      └─────────────┘      └─────────────┘                  │
│                                                                              │
│  MATERIAL FLOW (During Production)                                          │
│  ═════════════════════════════════                                          │
│                                                                              │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐                  │
│  │ Process 1   │─────▶│ Process 2   │─────▶│ Process 3   │────▶ ...        │
│  │ (Cutting)   │ WIP  │ (Stitching) │ WIP  │ (Finishing) │                  │
│  └─────────────┘      └─────────────┘      └─────────────┘                  │
│        │                    │                    │                           │
│        ▼                    ▼                    ▼                           │
│  ┌─────────────────────────────────────────────────────────┐                │
│  │ WIP TRACKING (per process):                             │                │
│  │ • Input Qty = Previous process output OR material in    │                │
│  │ • Output Qty = Forwarded to next process                │                │
│  │ • WIP = Input - Output (work in progress at station)    │                │
│  └─────────────────────────────────────────────────────────┘                │
│                                                                              │
│  MATERIAL OUT (Issue/Return)                                                │
│  ═══════════════════════════                                                │
│                                                                              │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐                  │
│  │ Record OUT  │─────▶│ Update      │─────▶│ Generate    │                  │
│  │ transaction │      │ Line Stock  │      │ Report      │                  │
│  │ (qty+notes) │      │             │      │             │                  │
│  └─────────────┘      └─────────────┘      └─────────────┘                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## CALCULATION FORMULAS

### 1. Takt Time

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TAKT TIME                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  DEFINITION: How often one unit must be produced to meet target demand       │
│                                                                              │
│  FORMULA:                                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │                                                                  │        │
│  │   Takt Time = Available Working Time (seconds) / Target         │        │
│  │                                                                  │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                              │
│  EXAMPLE:                                                                    │
│  ─────────                                                                   │
│  • Target (Demand) = 400 units                                               │
│  • Working Hours = 8 hours                                                   │
│                                                                              │
│  Step 1: Convert to seconds                                                  │
│          8 hours × 60 × 60 = 28,800 seconds                                  │
│                                                                              │
│  Step 2: Calculate Takt Time                                                 │
│          28,800 / 400 = 72 seconds                                           │
│                                                                              │
│  MEANING: One unit must be completed every 72 seconds                        │
│                                                                              │
│  DISPLAY FORMAT:                                                             │
│  • Under 60 sec: "45s"                                                       │
│  • Over 60 sec: "2m 42s" (162 seconds)                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. Efficiency

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EFFICIENCY                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  DEFINITION: How well available labor hours are utilized                     │
│                                                                              │
│  FORMULA:                                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │                                                                  │        │
│  │   Efficiency (%) = (Output × SAH) / (Manpower × Working Hours)  │        │
│  │                    × 100                                         │        │
│  │                                                                  │        │
│  │   OR                                                             │        │
│  │                                                                  │        │
│  │   Efficiency (%) = (Earned Hours / Available Hours) × 100       │        │
│  │                                                                  │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                              │
│  TERMS:                                                                      │
│  ┌────────────────┬────────────────────────────────────────────────┐        │
│  │ Term           │ Description                                     │        │
│  ├────────────────┼────────────────────────────────────────────────┤        │
│  │ Output         │ Total units produced                            │        │
│  │ SAH            │ Standard Allowed Hours per unit                 │        │
│  │ Manpower (MP)  │ Number of workers                               │        │
│  │ Working Hours  │ Hours per worker                                │        │
│  │ Earned Hours   │ Output × SAH                                    │        │
│  │ Available Hrs  │ Manpower × Working Hours                        │        │
│  └────────────────┴────────────────────────────────────────────────┘        │
│                                                                              │
│  EXAMPLE:                                                                    │
│  ─────────                                                                   │
│  • Output = 200 units                                                        │
│  • SAH = 1.5 hours/unit                                                      │
│  • Manpower = 70 workers                                                     │
│  • Working Hours = 8 hours                                                   │
│                                                                              │
│  Earned Hours = 200 × 1.5 = 300 hours                                        │
│  Available Hours = 70 × 8 = 560 hours                                        │
│  Efficiency = (300 / 560) × 100 = 53.57%                                     │
│                                                                              │
│  COLOR CODING:                                                               │
│  • 90%+ = Green (Excellent)                                                  │
│  • 80-89% = Lime (Good)                                                      │
│  • 70-79% = Yellow (Target)                                                  │
│  • 60-69% = Orange (Below Target)                                            │
│  • <60% = Red (Critical)                                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3. Other Calculations

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OTHER CALCULATIONS                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  COMPLETION PERCENTAGE                                                       │
│  ═════════════════════                                                       │
│  Formula: Completion (%) = (Actual Output / Target) × 100                    │
│  Example: (320 / 400) × 100 = 80%                                            │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  EMPLOYEE EFFICIENCY                                                         │
│  ═══════════════════                                                         │
│  Formula: (Units × Operation SAH) / Working Hours × 100                      │
│  Example: (150 × 0.02) / 8 × 100 = 37.5%                                     │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  SAH (Standard Allowed Hours)                                                │
│  ═════════════════════════════                                               │
│  Formula: SAH = Cycle Time (seconds) / 3600                                  │
│  Example: 72 seconds = 72/3600 = 0.02 hours                                  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  TARGET FROM TAKT TIME (Reverse)                                             │
│  ════════════════════════════════                                            │
│  Formula: Target = Working Time (sec) / Takt Time (sec)                      │
│  Example: 28,800 / 60 = 480 units                                            │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  REQUIRED MANPOWER                                                           │
│  ═════════════════                                                           │
│  Formula: (Target × Product SAH) / (Working Hours × Target Efficiency)       │
│  Example: (500 × 1.5) / (8 × 0.70) = 134 workers                             │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  WIP (Work In Progress)                                                      │
│  ══════════════════════                                                      │
│  Formula: WIP = Input Quantity - Output Quantity                             │
│  At any process station                                                      │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  HOURLY PROGRESS VALIDATION                                                  │
│  ══════════════════════════                                                  │
│  Rule: Completed Qty = Forwarded Qty + Remaining WIP                         │
│  Must balance at each hourly entry                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## DATABASE STRUCTURE

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DATABASE ENTITY RELATIONSHIPS                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐         ┌──────────────────┐                          │
│  │      users       │         │ production_lines │                          │
│  ├──────────────────┤         ├──────────────────┤                          │
│  │ id (PK)          │         │ id (PK)          │                          │
│  │ username         │         │ line_code        │                          │
│  │ password_hash    │         │ line_name        │                          │
│  │ full_name        │         │ hall_location    │                          │
│  │ role             │         │ current_product  │──────┐                   │
│  │ is_active        │         │   _id (FK)       │      │                   │
│  └──────────────────┘         │ qr_code_path     │      │                   │
│                               └────────┬─────────┘      │                   │
│                                        │                │                   │
│                      ┌─────────────────┘                │                   │
│                      │                                  │                   │
│                      ▼                                  ▼                   │
│  ┌──────────────────┐         ┌──────────────────┐                          │
│  │    employees     │         │     products     │                          │
│  ├──────────────────┤         ├──────────────────┤                          │
│  │ id (PK)          │         │ id (PK)          │                          │
│  │ emp_code         │         │ product_code     │                          │
│  │ emp_name         │         │ product_name     │                          │
│  │ designation      │         │ category         │                          │
│  │ default_line_id  │────────▶│ is_active        │                          │
│  │ qr_code_path     │         └────────┬─────────┘                          │
│  │ is_active        │                  │                                    │
│  └──────────────────┘                  │                                    │
│           │                            │                                    │
│           │                            ▼                                    │
│           │         ┌──────────────────────────────────┐                    │
│           │         │       product_processes          │                    │
│           │         ├──────────────────────────────────┤                    │
│           │         │ id (PK)                          │                    │
│           │         │ product_id (FK)                  │◀────┐              │
│           │         │ operation_id (FK)                │     │              │
│           │         │ sequence_number                  │     │              │
│           │         │ operation_sah                    │     │              │
│           │         │ cycle_time_seconds               │     │              │
│           │         │ target_units                     │     │              │
│           │         │ qr_code_path                     │     │              │
│           │         └──────────────────────────────────┘     │              │
│           │                            │                     │              │
│           │                            ▼                     │              │
│           │         ┌──────────────────────────────────┐     │              │
│           │         │         operations               │     │              │
│           │         ├──────────────────────────────────┤     │              │
│           │         │ id (PK)                          │     │              │
│           │         │ operation_code                   │     │              │
│           │         │ operation_name                   │     │              │
│           │         │ operation_category               │     │              │
│           │         │ qr_code_path                     │     │              │
│           │         └──────────────────────────────────┘     │              │
│           │                                                  │              │
│           ▼                                                  │              │
│  ┌────────────────────────────────────────────────┐          │              │
│  │       employee_process_assignments             │          │              │
│  ├────────────────────────────────────────────────┤          │              │
│  │ id (PK)                                        │          │              │
│  │ employee_id (FK)                               │          │              │
│  │ process_id (FK) ───────────────────────────────┼──────────┘              │
│  │ line_id (FK)                                   │                         │
│  │ assigned_at                                    │                         │
│  └────────────────────────────────────────────────┘                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Complete Table List

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATABASE TABLES                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CORE MASTER DATA                                                            │
│  ═════════════════                                                           │
│  ┌────────────────────────┬──────────────────────────────────────────────┐  │
│  │ Table                  │ Purpose                                       │  │
│  ├────────────────────────┼──────────────────────────────────────────────┤  │
│  │ users                  │ System users (admin, ie, supervisor, mgmt)   │  │
│  │ production_lines       │ Factory production lines                     │  │
│  │ employees              │ All factory workers                          │  │
│  │ products               │ Products/Styles being manufactured           │  │
│  │ operations             │ Master library of all operations             │  │
│  │ product_processes      │ Process flow for each product (sequence)     │  │
│  └────────────────────────┴──────────────────────────────────────────────┘  │
│                                                                              │
│  PLANNING & CONFIGURATION                                                    │
│  ═════════════════════════                                                   │
│  ┌────────────────────────┬──────────────────────────────────────────────┐  │
│  │ Table                  │ Purpose                                       │  │
│  ├────────────────────────┼──────────────────────────────────────────────┤  │
│  │ line_daily_plans       │ Daily product & target per line              │  │
│  │ app_settings           │ Default working hours, system config         │  │
│  │ production_day_locks   │ Lock/unlock production days                  │  │
│  └────────────────────────┴──────────────────────────────────────────────┘  │
│                                                                              │
│  EXECUTION & TRACKING                                                        │
│  ═════════════════════                                                       │
│  ┌────────────────────────┬──────────────────────────────────────────────┐  │
│  │ Table                  │ Purpose                                       │  │
│  ├────────────────────────┼──────────────────────────────────────────────┤  │
│  │ employee_attendance    │ Daily in/out times per employee              │  │
│  │ employee_process       │ Current employee→process assignments         │  │
│  │   _assignments         │                                              │  │
│  │ process_assignment     │ History of all assignment changes            │  │
│  │   _history             │                                              │  │
│  │ line_process_hourly    │ Hourly output per process                    │  │
│  │   _progress            │                                              │  │
│  │ line_daily_metrics     │ Daily line metrics (forwarded, WIP,          │  │
│  │                        │ materials, QA output)                        │  │
│  │ line_shift_closures    │ Shift close records                          │  │
│  └────────────────────────┴──────────────────────────────────────────────┘  │
│                                                                              │
│  MATERIALS                                                                   │
│  ═════════                                                                   │
│  ┌────────────────────────┬──────────────────────────────────────────────┐  │
│  │ Table                  │ Purpose                                       │  │
│  ├────────────────────────┼──────────────────────────────────────────────┤  │
│  │ material_transactions  │ Material IN/OUT transactions                 │  │
│  │ line_material_stock    │ Current stock per line                       │  │
│  │ process_material_wip   │ WIP at each process                          │  │
│  └────────────────────────┴──────────────────────────────────────────────┘  │
│                                                                              │
│  AUDIT & LOGS                                                                │
│  ═════════════                                                               │
│  ┌────────────────────────┬──────────────────────────────────────────────┐  │
│  │ Table                  │ Purpose                                       │  │
│  ├────────────────────────┼──────────────────────────────────────────────┤  │
│  │ audit_logs             │ All system changes with user/timestamp       │  │
│  └────────────────────────┴──────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Table Schemas

```sql
-- PRODUCTION LINES
CREATE TABLE production_lines (
    id SERIAL PRIMARY KEY,
    line_code VARCHAR(50) NOT NULL UNIQUE,
    line_name VARCHAR(100) NOT NULL,
    hall_location VARCHAR(100),
    current_product_id INTEGER REFERENCES products(id),
    qr_code_path VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- EMPLOYEES
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    emp_code VARCHAR(50) NOT NULL UNIQUE,
    emp_name VARCHAR(100) NOT NULL,
    designation VARCHAR(100),
    default_line_id INTEGER REFERENCES production_lines(id),
    qr_code_path VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PRODUCTS
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(50) NOT NULL UNIQUE,
    product_name VARCHAR(200) NOT NULL,
    category VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PRODUCT PROCESSES (Process Flow)
CREATE TABLE product_processes (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    operation_id INTEGER NOT NULL REFERENCES operations(id),
    sequence_number INTEGER NOT NULL,
    operation_sah DECIMAL(10,4) NOT NULL,
    cycle_time_seconds INTEGER,
    target_units INTEGER,
    qr_code_path VARCHAR(255),
    CONSTRAINT uq_product_sequence UNIQUE (product_id, sequence_number)
);

-- LINE DAILY PLANS
CREATE TABLE line_daily_plans (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    work_date DATE NOT NULL,
    target_units INTEGER NOT NULL,
    is_locked BOOLEAN DEFAULT false,
    CONSTRAINT uq_line_date UNIQUE (line_id, work_date)
);

-- HOURLY PROGRESS
CREATE TABLE line_process_hourly_progress (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id),
    process_id INTEGER NOT NULL REFERENCES product_processes(id),
    employee_id INTEGER REFERENCES employees(id),
    work_date DATE NOT NULL,
    hour INTEGER NOT NULL CHECK (hour >= 8 AND hour <= 19),
    quantity INTEGER NOT NULL DEFAULT 0,
    forwarded_quantity INTEGER DEFAULT 0,
    remaining_quantity INTEGER DEFAULT 0,
    CONSTRAINT uq_line_process_hour UNIQUE (line_id, process_id, work_date, hour)
);

-- LINE DAILY METRICS
CREATE TABLE line_daily_metrics (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id),
    work_date DATE NOT NULL,
    forwarded_quantity INTEGER DEFAULT 0,
    remaining_wip INTEGER DEFAULT 0,
    materials_issued INTEGER DEFAULT 0,
    qa_output INTEGER DEFAULT 0,
    CONSTRAINT uq_line_metrics_date UNIQUE (line_id, work_date)
);
```

---

## DATA CONNECTIONS & RELATIONSHIPS

### How Everything Connects

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DATA RELATIONSHIP FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. PRODUCT → PROCESS FLOW                                                   │
│  ═════════════════════════                                                   │
│                                                                              │
│  products ──1:N──▶ product_processes ──N:1──▶ operations                     │
│                                                                              │
│  A product (e.g., "ACCORDION WALLET") has many process steps                 │
│  (71 operations in sequence). Each step links to a master operation.         │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  2. LINE → DAILY PRODUCTION                                                  │
│  ══════════════════════════                                                  │
│                                                                              │
│  production_lines ──1:N──▶ line_daily_plans                                  │
│                     └───────▶ line_daily_metrics                             │
│                     └───────▶ line_process_hourly_progress                   │
│                     └───────▶ line_shift_closures                            │
│                                                                              │
│  Each line has daily plans, metrics, hourly progress, and shift records.     │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  3. EMPLOYEE → ASSIGNMENT → PROGRESS                                         │
│  ═══════════════════════════════════                                         │
│                                                                              │
│  employees ──1:1──▶ employee_process_assignments                             │
│              │            │                                                  │
│              │            └──▶ product_processes                             │
│              │            └──▶ production_lines                              │
│              │                                                               │
│              └──1:N──▶ process_assignment_history                            │
│              └──1:N──▶ line_process_hourly_progress                          │
│              └──1:N──▶ employee_attendance                                   │
│                                                                              │
│  An employee can only be assigned to ONE process at a time.                  │
│  All changes are logged in history with timestamps and quantities.           │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  4. METRICS CALCULATION FLOW                                                 │
│  ═══════════════════════════                                                 │
│                                                                              │
│  ┌─────────────────┐                                                         │
│  │ line_daily_plans│───▶ target_units                                        │
│  └─────────────────┘          │                                              │
│                               ▼                                              │
│  ┌─────────────────┐    ┌───────────┐    ┌─────────────────┐                │
│  │ employee_       │───▶│ Manpower  │───▶│ EFFICIENCY      │                │
│  │ attendance      │    │ Count     │    │ CALCULATION     │                │
│  └─────────────────┘    └───────────┘    └─────────────────┘                │
│                               │                 ▲                            │
│  ┌─────────────────┐          │                 │                            │
│  │ product_        │───▶ total_sah ─────────────┘                            │
│  │ processes       │                                                         │
│  └─────────────────┘                                                         │
│                                                                              │
│  ┌─────────────────┐    ┌───────────┐                                       │
│  │ line_daily_     │───▶│ qa_output │───▶ ACTUAL OUTPUT                     │
│  │ metrics         │    │ OR hourly │    (prefers QA if set)                │
│  └─────────────────┘    │ sum       │                                       │
│                         └───────────┘                                       │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  5. QR CODE LINKING                                                          │
│  ═══════════════════                                                         │
│                                                                              │
│  QR codes contain JSON payloads that link to database records:               │
│                                                                              │
│  Employee QR ──▶ employees.id                                                │
│  Process QR  ──▶ product_processes.id                                        │
│  Line QR     ──▶ production_lines.id                                         │
│  Operation QR──▶ operations.id                                               │
│                                                                              │
│  Scanning a QR instantly identifies the record in the system.                │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  6. DAY LOCK ENFORCEMENT                                                     │
│  ═══════════════════════                                                     │
│                                                                              │
│  production_day_locks.work_date                                              │
│         │                                                                    │
│         ▼                                                                    │
│  When locked, BLOCKS:                                                        │
│  • IE attendance updates                                                     │
│  • Daily plan changes                                                        │
│  • Supervisor progress entry                                                 │
│  • Employee assignments                                                      │
│  • Metrics updates                                                           │
│                                                                              │
│  line_shift_closures                                                         │
│         │                                                                    │
│         ▼                                                                    │
│  When shift closed, BLOCKS:                                                  │
│  • Further entries for that line+date                                        │
│  • Only Admin can unlock                                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## API ENDPOINTS SUMMARY

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          API ENDPOINTS                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  AUTHENTICATION                                                              │
│  ══════════════                                                              │
│  POST   /auth/login              Login with role                             │
│  GET    /auth/session            Check current session                       │
│  POST   /auth/logout             Logout                                      │
│                                                                              │
│  ADMIN APIs                                                                  │
│  ══════════                                                                  │
│  GET    /api/dashboard/stats     Dashboard statistics                        │
│  CRUD   /api/users               User management                             │
│  CRUD   /api/lines               Production lines                            │
│  CRUD   /api/employees           Employees                                   │
│  CRUD   /api/products            Products                                    │
│  CRUD   /api/operations          Operations library                          │
│  CRUD   /api/product-processes   Process flow management                     │
│  GET    /api/audit-logs          View audit logs                             │
│  CRUD   /api/production-days     Lock/unlock days                            │
│  GET    /api/line-shifts         View shift closures                         │
│  POST   /api/line-shifts/unlock  Unlock closed shift                         │
│                                                                              │
│  IE APIs                                                                     │
│  ═══════                                                                     │
│  CRUD   /api/daily-plans         Daily production plans                      │
│  GET    /api/ie/attendance       Get attendance for date                     │
│  POST   /api/ie/attendance       Mark attendance                             │
│  GET    /api/settings            Get app settings                            │
│  POST   /api/settings            Update default hours                        │
│                                                                              │
│  SUPERVISOR APIs                                                             │
│  ═══════════════                                                             │
│  GET    /api/supervisor/resolve-process   Resolve process from QR            │
│  POST   /api/supervisor/assign            Assign employee to process         │
│  POST   /api/supervisor/progress          Log hourly progress                │
│  CRUD   /api/line-metrics                 Line daily metrics                 │
│  GET    /api/supervisor/shift-summary     End of shift summary               │
│  POST   /api/supervisor/close-shift       Close shift                        │
│  CRUD   /api/supervisor/materials         Material transactions              │
│                                                                              │
│  METRICS APIs                                                                │
│  ════════════                                                                │
│  GET    /api/lines/:id/metrics   Single line metrics                         │
│  GET    /api/lines-metrics       All lines metrics summary                   │
│                                                                              │
│  REPORTS APIs                                                                │
│  ════════════                                                                │
│  GET    /api/reports/daily       Download daily Excel report                 │
│  GET    /api/reports/range       Download date range Excel report            │
│                                                                              │
│  REAL-TIME                                                                   │
│  ══════════                                                                  │
│  GET    /events                  Server-Sent Events (SSE) stream             │
│                                  Pushes updates on data changes              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## REAL-TIME UPDATE FLOW

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       REAL-TIME UPDATES (SSE)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  DATABASE TRIGGER                                                            │
│       │                                                                      │
│       ▼                                                                      │
│  ┌────────────────┐                                                          │
│  │ NOTIFY channel │  (PostgreSQL LISTEN/NOTIFY)                              │
│  │ with JSON      │                                                          │
│  │ payload        │                                                          │
│  └───────┬────────┘                                                          │
│          │                                                                   │
│          ▼                                                                   │
│  ┌────────────────┐                                                          │
│  │ Node.js        │                                                          │
│  │ Listener       │                                                          │
│  └───────┬────────┘                                                          │
│          │                                                                   │
│          ▼                                                                   │
│  ┌────────────────┐      ┌─────────────────────────────┐                    │
│  │ SSE Broadcast  │─────▶│ All connected clients       │                    │
│  │ /events        │      │ (Admin, IE, Supervisor,     │                    │
│  └────────────────┘      │  Management dashboards)     │                    │
│                          └─────────────────────────────┘                    │
│                                     │                                        │
│                                     ▼                                        │
│                          ┌─────────────────────────────┐                    │
│                          │ UI refreshes affected       │                    │
│                          │ section only                │                    │
│                          │ (not full page reload)      │                    │
│                          └─────────────────────────────┘                    │
│                                                                              │
│  EVENTS TRIGGERED BY:                                                        │
│  • Employee assignment changes                                               │
│  • Hourly progress updates                                                   │
│  • Attendance changes                                                        │
│  • Daily plan updates                                                        │
│  • Material transactions                                                     │
│  • Shift closures                                                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## EXCEL REPORT STRUCTURE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      EXCEL REPORT SHEETS                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Daily/Range Report contains 4 sheets:                                       │
│                                                                              │
│  SHEET 1: LINE SUMMARY                                                       │
│  ═════════════════════                                                       │
│  │ Date │ Line │ Product │ Target │ QA Output │ Hourly Total │              │
│  │      │      │         │        │           │ Efficiency │ Completion │   │
│                                                                              │
│  SHEET 2: MATERIALS SUMMARY                                                  │
│  ══════════════════════════                                                  │
│  │ Date │ Line │ Forwarded Qty │ Remaining WIP │ Materials Issued │         │
│                                                                              │
│  SHEET 3: PROCESS OUTPUT                                                     │
│  ═══════════════════════                                                     │
│  │ Date │ Line │ Process │ Hour 8 │ Hour 9 │ ... │ Hour 19 │ Total │        │
│                                                                              │
│  SHEET 4: EMPLOYEE EFFICIENCY                                                │
│  ═════════════════════════════                                               │
│  │ Date │ Line │ Employee Code │ Employee Name │ Process │                  │
│  │      │      │ Output │ SAH Earned │ Efficiency % │                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## SAMPLE DATA

### Current System Data

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SAMPLE DATA IN SYSTEM                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PRODUCTION LINES (2)                                                        │
│  ════════════════════                                                        │
│  │ Code         │ Name                 │ Location │ Employees │              │
│  │──────────────│──────────────────────│──────────│───────────│              │
│  │ RUMIYA_LINE  │ HALL B RUMIYA LINE   │ Hall B   │ 105       │              │
│  │ GAFOOR_LINE  │ HALL A GAFOOR LINE   │ Hall A   │ 37        │              │
│                                                                              │
│  PRODUCTS (1)                                                                │
│  ════════════                                                                │
│  │ Code  │ Name             │ Category │ Operations │ Total SAH │            │
│  │───────│──────────────────│──────────│────────────│───────────│            │
│  │ CY405 │ ACCORDION WALLET │ WALLET   │ 71         │ 1.4928 hrs│            │
│                                                                              │
│  EMPLOYEES (142)                                                             │
│  ═══════════════                                                             │
│  All employees have QR codes generated                                       │
│  Stored in: /home/worksync/worksync/qrcodes/employees/                       │
│                                                                              │
│  OPERATIONS CATEGORIES                                                       │
│  ═════════════════════                                                       │
│  • GENERAL                                                                   │
│  • PASTING                                                                   │
│  • STITCHING                                                                 │
│  • CUTTING                                                                   │
│  • EDGE_INKING                                                               │
│  • HEATING                                                                   │
│  • PRIMER                                                                    │
│  • EMBOSSING                                                                 │
│  • GRINDING                                                                  │
│                                                                              │
│  SAMPLE PROCESS FLOW (CY405 - First 10 of 71)                               │
│  ═════════════════════════════════════════════                               │
│  │ Seq │ Operation                              │ Cycle(s) │ SAH    │        │
│  │─────│────────────────────────────────────────│──────────│────────│        │
│  │ 1   │ E.I PROCESS (STEP & STAMP PKT)         │ 117      │ 0.0325 │        │
│  │ 2   │ 1st patti & step patt with nonwoon     │ 64       │ 0.0178 │        │
│  │ 3   │ stamp & step patti pasting             │ 60       │ 0.0167 │        │
│  │ 4   │ coin pkt lining pasting                │ 60       │ 0.0167 │        │
│  │ 5   │ coin pkt creasing                      │ 86       │ 0.0239 │        │
│  │ 6   │ coin pkt stitch                        │ 91       │ 0.0253 │        │
│  │ 7   │ zipper tape attach                     │ 77       │ 0.0214 │        │
│  │ 8   │ zipper tape stitch                     │ 83       │ 0.0231 │        │
│  │ 9   │ zipper folding process                 │ 60       │ 0.0167 │        │
│  │ 10  │ 1st divider cover pasting              │ 60       │ 0.0167 │        │
│  │ ... │ ... (61 more operations)               │ ...      │ ...    │        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ACCESS INFORMATION

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ACCESS URLS                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  SERVER: Raspberry Pi 5 (192.168.1.9)                                        │
│                                                                              │
│  HTTP  (internal use):     http://192.168.1.9:3000                          │
│  HTTPS (camera/QR scan):   https://192.168.1.9:3443                         │
│                                                                              │
│  PAGES:                                                                      │
│  ───────                                                                     │
│  Login:           /                                                          │
│  Admin:           /admin                                                     │
│  IE Panel:        /ie                                                        │
│  Supervisor:      /supervisor                                                │
│  Management:      /management                                                │
│                                                                              │
│  HEALTH CHECK:    /health                                                    │
│  API BASE:        /api/*                                                     │
│  REAL-TIME:       /events (SSE)                                              │
│                                                                              │
│  DEFAULT PASSWORDS (Change in production!):                                  │
│  ───────────────────────────────────────────                                 │
│  admin:       admin1234                                                      │
│  ie:          ie1234                                                         │
│  supervisor:  sup1234                                                        │
│  management:  manage1234                                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

