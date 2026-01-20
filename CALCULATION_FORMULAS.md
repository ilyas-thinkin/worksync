# WorkSync - Production Calculation Formulas

This document contains all the formulas used in WorkSync for production tracking and efficiency monitoring.

---

## 1. Takt Time

### What is Takt Time?
Takt Time tells you how often one unit must be produced to meet customer demand, based on the available working time.

**In simple words:** "One product should come out every ___ seconds."

### Formula

```
Takt Time = Total Available Working Time (seconds) / Target (Demand)
```

### Example Calculation

**Given Values:**
- Target (Demand) = 400 units
- Working Hours per Day = 8 hours

**Step 1: Convert Working Hours to Seconds**
```
8 hours = 8 × 60 × 60 = 28,800 seconds
```

**Step 2: Apply the Takt Time Formula**
```
Takt Time = 28,800 / 400
```

**Step 3: Final Result**
```
Takt Time = 72 seconds
```

**Meaning:** One unit must be completed every 72 seconds to meet the target of 400 units.

---

## 2. Efficiency

### What is Efficiency?
Efficiency measures how well the available labor hours are being utilized compared to the standard time required for production.

### Formula

```
Efficiency (%) = (Target × SAH) / (MP × WH) × 100
```

Or expressed as:

```
Efficiency (%) = (Earned Hours / Available Hours) × 100
```

### Meaning of Each Term

| Term | Description |
|------|-------------|
| **Target** | Total number of units produced |
| **SAH** | Standard Allowed Hours - Time required to produce one unit (in hours) |
| **MP** | Man Power - Number of workers |
| **WH** | Working Hours - Working hours per worker |
| **Earned Hours** | Target × SAH (Standard hours "earned" by production) |
| **Available Hours** | MP × WH (Total labor hours available) |

### Example Calculation

**Given Values:**
- Target = 200 units
- SAH = 0.5 hours/unit
- MP = 35 persons
- WH = 8 hours

**Step 1: Calculate Earned Hours**
```
Earned Hours = Target × SAH
             = 200 × 0.5
             = 100 hours
```
*This means the production earned 100 standard hours.*

**Step 2: Calculate Available Hours**
```
Available Hours = MP × WH
                = 35 × 8
                = 280 hours
```
*This means 280 total labor hours were available.*

**Step 3: Calculate Efficiency**
```
Efficiency = (100 / 280) × 100
           = 35.71%
           ≈ 36%
```

---

## 3. Completion Percentage

### Formula

```
Completion (%) = (Actual Output / Target) × 100
```

### Example

- Target = 400 units
- Actual Output = 320 units

```
Completion = (320 / 400) × 100 = 80%
```

---

## 4. Employee Efficiency

### Formula

```
Employee Efficiency (%) = (Units Produced × Operation SAH) / Working Hours × 100
```

### Example

- Units Produced = 150
- Operation SAH = 0.02 hours (72 seconds)
- Working Hours = 8 hours

```
Employee Efficiency = (150 × 0.02) / 8 × 100
                    = 3 / 8 × 100
                    = 37.5%
```

---

## 5. Line Efficiency

### Formula

```
Line Efficiency (%) = (Total Output × Product SAH) / (Total Manpower × Working Hours) × 100
```

### Example

- Total Output = 200 units
- Product SAH = 1.5 hours (total SAH for all operations)
- Total Manpower = 70 workers
- Working Hours = 8 hours

```
Line Efficiency = (200 × 1.5) / (70 × 8) × 100
                = 300 / 560 × 100
                = 53.57%
```

---

## 6. SAH (Standard Allowed Hours)

### Converting Cycle Time to SAH

```
SAH = Cycle Time (seconds) / 3600
```

### Example

- Cycle Time = 72 seconds

```
SAH = 72 / 3600 = 0.02 hours
```

---

## 7. Target Calculation (Reverse)

### If you know Takt Time and want to calculate Target:

```
Target = Available Working Time (seconds) / Takt Time (seconds)
```

### Example

- Working Hours = 8 hours = 28,800 seconds
- Desired Takt Time = 60 seconds

```
Target = 28,800 / 60 = 480 units
```

---

## 8. Required Manpower Calculation

### Formula

```
Required Manpower = (Target × Product SAH) / (Working Hours × Target Efficiency)
```

### Example

- Target = 500 units
- Product SAH = 1.5 hours
- Working Hours = 8 hours
- Target Efficiency = 70% (0.70)

```
Required Manpower = (500 × 1.5) / (8 × 0.70)
                  = 750 / 5.6
                  = 134 workers
```

---

## Summary Table

| Metric | Formula | Unit |
|--------|---------|------|
| Takt Time | Working Time (sec) / Target | seconds |
| Efficiency | (Output × SAH) / (MP × WH) × 100 | % |
| Completion | (Actual / Target) × 100 | % |
| SAH | Cycle Time (sec) / 3600 | hours |
| Earned Hours | Output × SAH | hours |
| Available Hours | Manpower × Working Hours | hours |

---

## WorkSync Implementation

These formulas are implemented in the following API endpoints:

- **GET `/api/lines/:id/metrics`** - Single line metrics
- **GET `/api/lines-metrics`** - All lines metrics summary

### Default Values in WorkSync

| Setting | Default Value |
|---------|---------------|
| Working Hours | Configurable (default 08:00 - 17:00) |
| Target Efficiency | 70% |

**Notes:**
- Daily line targets are stored in `line_daily_plans` and override line defaults for that date.
- Hourly production entry is limited to 08:00–19:00 in supervisor execution.

---

*Last Updated: January 2026*
*WorkSync - Factory Production Tracking System*
