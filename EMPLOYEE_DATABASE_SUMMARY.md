# WorkSync Employee Database - Current Summary

**Updated:** 2026-01-19
**Source:** Employee import (EMPLOYEE LIST.xlsx) + ongoing updates

---

## ✅ CURRENT STATUS

### Key Tables (Employee-Related)

| Table Name | Purpose |
|------------|---------|
| **employees** | Employee master data |
| **employee_process_assignments** | Current assignment (line + process + employee) |
| **employee_attendance** | Daily in/out timings |
| **process_assignment_history** | Assignment change history + quantity/materials at link |
| **audit_logs** | Change tracking |

---

## 📊 PRODUCTION LINES (Current)

| ID | Code | Name | Hall | Status |
|----|------|------|------|--------|
| 1 | RUMIYA_LINE | HALL B RUMIYA LINE | Hall B | ✓ Active |
| 2 | GAFOOR_LINE | HALL A GAFOOR LINE | Hall A | ✓ Active |
| 3 | TEST1 | TEST_LINE | HALL A | ✓ Active |
| 4 | TEST2 | TEST_LINE2 | HALL A | ✗ Inactive |

---

## 👥 EMPLOYEE STATISTICS

- **Total Employees:** 143
- **Active Employees:** 143
- **QR Codes Generated:** 143 (100%)
- **QR Code Storage:** `/home/worksync/worksync/qrcodes/employees/`

### Employees per Line (Current Assignments)
*Based on `employee_process_assignments` (one employee can be assigned only once globally):*

- **HALL B RUMIYA LINE:** 1
- **HALL A GAFOOR LINE:** 71
- **TEST_LINE:** 1

### Employees by Designation

| Designation | Count |
|-------------|-------|
| Table Worker | 58 |
| Stitcher | 35 |
| Edge Inking | 23 |
| Hw M/C Optr | 9 |
| Ams Stitcher | 9 |
| Lw M/C Optr | 6 |
| Associate | 2 |
| (Unspecified) | 1 |

---

## 🗄️ DATABASE SCHEMA (Employee-Focused)

### employees

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| emp_code | VARCHAR(50) | Unique employee code (e.g., LPD00059) |
| emp_name | VARCHAR(100) | Employee full name |
| designation | VARCHAR(100) | Job designation |
| default_line_id | INTEGER | Legacy line link (not used for assignments) |
| qr_code_path | VARCHAR(255) | QR code image path |
| is_active | BOOLEAN | Active status (default: true) |
| created_at | TIMESTAMP | Record creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

**Notes:** Employee assignment is controlled by `employee_process_assignments` (one active assignment per employee).

### employee_process_assignments

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| process_id | INTEGER | FK → product_processes |
| employee_id | INTEGER | FK → employees (unique) |
| line_id | INTEGER | FK → production_lines |
| assigned_at | TIMESTAMP | Assignment timestamp |

**Constraint:** one employee can be linked to only one assignment at a time.

### employee_attendance

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| employee_id | INTEGER | FK → employees |
| attendance_date | DATE | Work date |
| in_time | TIME | In time |
| out_time | TIME | Out time |
| status | TEXT | present/absent/left_early |
| notes | TEXT | IE notes |

### process_assignment_history

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| line_id | INTEGER | FK → production_lines |
| process_id | INTEGER | FK → product_processes |
| employee_id | INTEGER | FK → employees |
| start_time | TIMESTAMP | Assignment start |
| end_time | TIMESTAMP | Assignment end |
| quantity_completed | INTEGER | Qty before change |
| materials_at_link | INTEGER | Materials count at link |

---

## 📁 QR CODE FILES

**Location:** `/home/worksync/worksync/qrcodes/employees/`

**Format:**
- Filename: `employee_{id}.png` (e.g., `employee_59.png`)
- QR Data: JSON payload
  ```json
  {"type":"employee","id":59,"code":"LPD00059","name":"A. NOORUN"}
  ```

---

## 🔍 SAMPLE QUERIES

### Current Assigned Employees by Line
```sql
SELECT pl.line_name, COUNT(DISTINCT a.employee_id) AS employees
FROM production_lines pl
LEFT JOIN employee_process_assignments a ON a.line_id = pl.id
GROUP BY pl.line_name
ORDER BY pl.line_name;
```

### Get Employee by QR Scan (code)
```sql
SELECT id, emp_code, emp_name, designation
FROM employees
WHERE emp_code = 'LPD00059'
  AND is_active = true;
```

### Get Current Assignment for an Employee
```sql
SELECT a.line_id, a.process_id, pl.line_name
FROM employee_process_assignments a
JOIN production_lines pl ON pl.id = a.line_id
WHERE a.employee_id = 59;
```

---

## ✅ VERIFICATION CHECKLIST

- [x] employees table created
- [x] employee_process_assignments enabled (one assignment per employee)
- [x] employee_attendance active for IE updates
- [x] process_assignment_history logs changes and quantities
- [x] QR code paths stored in DB

