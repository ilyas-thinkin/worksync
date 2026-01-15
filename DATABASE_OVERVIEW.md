# WorkSync Database - Detailed Overview

**Database:** worksync_db  
**Status:** ✅ Operational

---

## 📊 Current Tables (8)

- **production_lines**: Factory lines (code, name, hall, current product, target, efficiency, QR)
- **products**: Product master (code, name, category)
- **operations**: Master operation library (code, name, category)
- **product_processes**: Process steps for each product (sequence, SAH, cycle time)
- **employees**: Employee master (code, name, designation, efficiency, QR)
- **employee_process_assignments**: Current work assignment (line + process + employee)
- **employee_attendance**: Daily in/out timings and status (IE panel)
- **audit_logs**: Change tracking (table, action, old/new values)

---

## 🔗 How the Tables Are Linked

### 1) Production Lines → Current Product
- `production_lines.current_product_id` → `products.id`
- This tells which product is currently running on each line.

### 2) Products → Process Flow
- `product_processes.product_id` → `products.id`
- Each product has a sequence of operations with SAH/cycle time.

### 3) Process Steps → Operations
- `product_processes.operation_id` → `operations.id`
- Operations are reusable across products; process flow selects and sequences them.

### 4) Employees → Current Work Assignment
- `employee_process_assignments.employee_id` → `employees.id`
- `employee_process_assignments.process_id` → `product_processes.id`
- `employee_process_assignments.line_id` → `production_lines.id`
- Rule: **one employee can be assigned to only one work at a time**.

### 5) Attendance (IE Panel)
- `employee_attendance.employee_id` → `employees.id`
- `employee_attendance.attendance_date` + `employee_id` is unique (one record per day).

---

## 🧭 Relationship Diagram (Logical)

```
production_lines
    └─ current_product_id → products

products
    └─ product_processes (sequence of steps)
           └─ operation_id → operations

employees
    └─ employee_process_assignments
           ├─ line_id → production_lines
           └─ process_id → product_processes

employees
    └─ employee_attendance (per day)
```

---

## 🧩 Key Concepts

### Operations vs Process Steps
- **operations** are the reusable master list.
- **product_processes** are the actual steps for a specific product with sequence + SAH.

### Current Work Assignment
Each assignment is tied to:
- **Line** (where the work happens)
- **Process step** (what work is being done)
- **Employee** (who is doing it)

This allows the same product to run on multiple lines with different employees.

### Attendance and Timing
IE updates `employee_attendance` per day:
- Default in/out time: **08:00–17:00**
- Can be adjusted per employee per day (early leave, late start, etc.)

---

## ✅ What This Enables

- Real-time line status (current product, process flow)
- Accurate employee assignment tracking
- Attendance-based efficiency calculations
- QR-driven identification (employees, lines, processes)

---

## 📝 Notes

- QR code paths are stored in:
  - `employees.qr_code_path`
  - `production_lines.qr_code_path`
  - `product_processes.qr_code_path`

- Assignments are **global**: once an employee is assigned, they are unavailable elsewhere until unassigned.
