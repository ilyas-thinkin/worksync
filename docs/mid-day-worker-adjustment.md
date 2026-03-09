# Mid-Day Worker Adjustment — Feature Specification
**Document Version:** 1.0
**Date:** 2026-03-04
**Status:** Pending Approval

---

## 1. Overview

In a garment manufacturing environment, it is common for a worker to leave the line mid-shift due to personal, medical, or operational reasons. When this happens, the supervisor must redistribute that worker's tasks to the remaining workers on the same line to maintain production continuity.

This document defines the process flow, data capture, and efficiency calculation methodology for handling mid-day worker departures and workstation reassignments within the WorkSync Line Leader (Supervisor) panel.

---

## 2. Process Flow

### Phase 1 — Worker Departure

1. A worker notifies the line supervisor that they are leaving mid-shift.
2. The supervisor opens the **Line Leader panel** and navigates to the active employee list for that line.
3. The supervisor selects the departing employee and clicks **Mark Departure**.
4. A modal prompts the supervisor to enter:
   - **Departure Reason** — Sick / Personal / Operational / Other
   - **Departure Time** — auto-filled with current time, editable if needed
5. On confirmation, the system:
   - Logs the departure record (employee, line, workstation, departure time, reason)
   - **Locks** the employee's output data up to that point — no further hourly entries can be posted against them
   - Marks that workstation as **vacant** on the line

---

### Phase 2 — Worker Adjustment

1. The supervisor navigates to the **Worker Adjustment** section in the Line Leader panel.
2. The supervisor scans the **Workstation QR** of the vacant workstation → system identifies which workstation needs coverage and who was originally assigned.
3. The supervisor scans the **Employee QR** of the receiving worker (must be an active employee on the same line).
4. The system displays a confirmation prompt:

   > **WS3 was assigned to [Alice].
   > What would you like to do with [Bob]?**
   >
   > [ Assign to WS3 ] &nbsp;&nbsp; [ Combine WS3 into Bob's WS2 ]

---

### Phase 3A — Assign (Full Transfer)

The receiving worker **moves entirely** to the vacant workstation.

- Bob's original workstation (WS2) becomes unmanned.
- Bob is reassigned from WS2 to WS3 in the system.
- All future hourly output entries for WS3 are attributed to Bob.
- Bob's efficiency is calculated based on WS3 output and WS3 cycle time for the hours he worked there.

**Use case:** WS2 is a lower-priority or buffer station and can be left unmanned for the remainder of the shift.

---

### Phase 3B — Combine (Dual Coverage)

The receiving worker **stays on their own workstation and also covers the vacant one**.

- Bob remains on WS2 and additionally takes responsibility for WS3.
- The system records the **reassignment timestamp** — this is the point from which Bob's combined calculation begins.
- Hourly output is entered separately for WS2 and WS3 in the supervisor panel.
- Bob's efficiency is calculated across both workstations.

**Use case:** Both workstations are critical and cannot be left unmanned.

---

### Phase 4 — Data Logging

On confirmation of either action, the system records:

| Field | Description |
|---|---|
| Line | The production line |
| Work Date | Current shift date |
| Vacant Workstation | The workstation left by the departed worker |
| From Employee | The worker who departed (Alice) |
| To Employee | The worker taking over (Bob) |
| Adjustment Type | `assign` or `combine` |
| Reassignment Time | Timestamp of the supervisor's action |

This record is permanent and used in efficiency calculations and audit reporting.

---

## 3. Efficiency Calculations

### 3.1 Departed Worker (Alice)

**Formula:**

```
Alice's Efficiency (%) =  Alice's Output × WS3 Cycle Time (h)
                          ─────────────────────────────────────  × 100
                                  Alice's Hours Worked
```

**Where:**
- **Alice's Output** = total units produced on WS3 from shift start to departure time (locked after departure)
- **WS3 Cycle Time (h)** = sum of SAH (Standard Allowed Hours) for all operations assigned to WS3
- **Alice's Hours Worked** = Departure Time − Shift Start Time

**Reason:**
Alice only worked a partial shift. Her denominator must reflect the actual hours she was present — using the full shift hours would unfairly deflate her efficiency. SAH-based cycle time ensures the calculation is standardised and independent of line speed or style variation.

---

### 3.2 Receiving Worker — Assign Mode (Bob on WS3 only)

**Formula:**

```
Bob's Efficiency (%) =  Bob's Output on WS3 × WS3 Cycle Time (h)
                        ──────────────────────────────────────────  × 100
                                  Bob's Hours on WS3
```

**Where:**
- **Bob's Output on WS3** = units entered for WS3 from reassignment time to shift end
- **Bob's Hours on WS3** = Shift End Time − Reassignment Time
- Bob's WS2 efficiency is calculated separately for the period before reassignment

**Reason:**
Bob's time is split into two distinct periods with two distinct workstation responsibilities. Each period is evaluated independently to give an accurate picture of performance in each role.

---

### 3.3 Receiving Worker — Combine Mode (Bob on WS2 + WS3)

Combine mode introduces a **two-period calculation**:

#### Period 1 — Before Combine (Bob on WS2 only)

```
Bob Pre-Combine Efficiency (%) =  Bob's WS2 Output (Period 1) × WS2 Cycle Time (h)
                                  ──────────────────────────────────────────────────  × 100
                                            Hours Before Reassignment
```

#### Period 2 — After Combine (Bob on WS2 + WS3)

```
Bob Post-Combine Efficiency (%) =  (WS2 Output × WS2 Cycle Time (h)) + (WS3 Output × WS3 Cycle Time (h))
                                   ─────────────────────────────────────────────────────────────────────  × 100
                                                         Hours After Reassignment
```

#### Overall Bob Efficiency

```
Bob's Overall Efficiency (%) =  Total SAH Earned (Period 1 + Period 2)
                                ──────────────────────────────────────  × 100
                                        Bob's Total Working Hours
```

**Where Total SAH Earned:**

```
= (WS2_output_period1 × WS2_cycle_time_h)
+ (WS2_output_period2 × WS2_cycle_time_h)
+ (WS3_output_period2 × WS3_cycle_time_h)
```

---

### 3.4 Interpretation of Combine Efficiency

| Result | Meaning |
|---|---|
| ~100% | Bob maintained ~50% output at each station — he managed both but at reduced pace |
| ~150% | Bob maintained strong output at his own station and partial output at the combined station |
| ~200% | Bob matched standard output at BOTH stations — exceptional performance |
| < 100% | Bob struggled to manage dual coverage; output below standard for combined workload |

**Reason for this range:**
In combine mode, Bob is doing the work of two employees within a single shift. If he fully meets the standard at both stations, his efficiency will approach 200% because his SAH earnings double while his available hours remain the same. This is intentional — it correctly reflects that Bob absorbed the work of a departed colleague and rewards full dual-coverage performance accordingly.

---

## 4. Key Design Decisions

### 4.1 Why SAH-based Cycle Time?

SAH (Standard Allowed Hours) is the client-approved industry standard for measuring garment manufacturing productivity. It is style-specific, operation-specific, and independent of line speed. Using SAH ensures efficiency figures are comparable across lines, styles, and dates.

### 4.2 Why split into two time periods for combine?

Without the time split, Bob's combined post-departure output would be divided by his full shift hours — artificially depressing his pre-combine performance. The split correctly attributes performance to the right context (single-WS vs dual-WS responsibility).

### 4.3 Why lock Alice's output at departure time?

Any output entered after Alice's recorded departure time would be inaccurate — that work was physically done by Bob (or not done at all). Locking the data at departure time ensures no overlap or double-attribution between Alice and Bob for the same workstation.

### 4.4 Why require the same-line restriction?

A worker from a different line would be unfamiliar with the operations assigned to that workstation, introducing quality and safety risk. The system enforces same-line eligibility to reflect standard factory floor practice.

---

## 5. Screens / UI Changes

| Screen | Change |
|---|---|
| Supervisor — Morning Procedure | Add **Mark Departure** button per employee with reason + time modal |
| Supervisor — Hourly Procedure | Show vacant workstation indicator; disable output entry for departed employee |
| Supervisor — Worker Adjustment *(new)* | QR scan flow: Workstation → Employee → Assign/Combine prompt |
| Admin / IE — Efficiency Report | Show split efficiency rows for combined workers (Period 1 / Period 2 / Overall) |

---

## 6. Data Changes

| Table | Purpose |
|---|---|
| `employee_mid_departures` | Logs departure time, reason, workstation per employee per shift |
| `workstation_mid_reassignments` | Logs assign/combine action, from/to employee, workstations, timestamp |

No changes to existing tables. These are additive records only.

---

## 7. Approval

| Role | Name | Signature | Date |
|---|---|---|---|
| IE / Process Owner | | | |
| Production Manager | | | |
| IT / Developer | | | |

---

*Prepared by WorkSync System — for internal approval only.*
