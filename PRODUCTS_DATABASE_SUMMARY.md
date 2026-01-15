# WorkSync Products & Operations Database - Setup Complete

**Date:** 2026-01-14
**Source:** GAFOOR LINE.xlsx

---

## ✅ DATABASE SETUP COMPLETE

### Tables Created for Products & Operations

| Table Name | Description | Records |
|------------|-------------|---------|
| **products** | Product master data (styles, wallets, etc.) | 1 |
| **operations** | Master list of ALL possible operations | 71 |
| **product_processes** | Product-specific operation sequences with SAH | 5 |
| **workspaces** | Physical workspaces/machines (ready for future) | 0 |

---

## 📊 MASTER OPERATIONS LIBRARY

**Total Operations:** 71 operations imported from GAFOOR LINE.xlsx

### Operations by Category

| Category | Count | Examples |
|----------|-------|----------|
| **GENERAL** | 22 | Beeding, Attaching, Logo bit insert |
| **PASTING** | 18 | Patti pasting, Cover lining, Nonwoon pasting |
| **STITCHING** | 15 | Side stitching, Patti stitching, Close stitching |
| **CUTTING** | 5 | CC pkt recutting, Gusset recutting |
| **PRIMER** | 3 | Gusset primer, Leather primer |
| **HEATING** | 3 | Gusset heating, PVC heating |
| **EDGE_INKING** | 3 | E.I Process, Step & stamp, Window pkt |
| **EMBOSSING** | 1 | Gusset embossing |
| **GRINDING** | 1 | Logo grinding |

### Sample Operations

```
OP_001 | EDGE_INKING | E.I PROCESS (STEP & STAMP PKT), (WINDOW PKT), (CC PKT)
OP_002 | PASTING     | 1st patti & step patt with nonwoon pasting & att
OP_003 | PASTING     | stamp & step patti pasting & atttatching
OP_006 | GENERAL     | 1st patti & step patti with ams'lining close side stitching
OP_007 | STITCHING   | cc pkt with side stitching
OP_009 | CUTTING     | cc pkt recutting process
OP_027 | GENERAL     | Gusset leather die process
OP_028 | HEATING     | Gusset pvc heating process
```

---

## 🎯 PRODUCT: CY405 (ACCORDION WALLET)

**Sample Product with Complete Process Flow**

### Product Details
- **Product Code:** CY405
- **Product Name:** ACCORDION WALLET
- **Category:** WALLET
- **Total Operations:** 5
- **Total SAH:** 0.0556 hours (3.34 minutes)

### Process Flow

| Seq | Operation Code | Operation Name | Category | Cycle Time | SAH | Manpower |
|-----|----------------|----------------|----------|------------|-----|----------|
| 1 | OP_028 | Gusset pvc heating process | HEATING | 30s | 0.0083 | 1 |
| 2 | OP_027 | Gusset leather die process | GENERAL | 50s | 0.0139 | 1 |
| 3 | OP_001 | E.I PROCESS (STEP & STAMP PKT) | EDGE_INKING | 20s | 0.0056 | 1 |
| 4 | OP_002 | 1st patti & step patt with nonwoon pasting | PASTING | 60s | 0.0167 | 1 |
| 5 | OP_006 | 1st patti & step patti with ams'lining close side stitching | GENERAL | 40s | 0.0111 | 1 |

**Total Product SAH = 0.0556 hours**

---

## 🗄️ DATABASE SCHEMA

### products Table

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| product_code | VARCHAR(50) | Unique product code (e.g., CY405) |
| product_name | VARCHAR(200) | Product name (e.g., ACCORDION WALLET) |
| product_description | TEXT | Optional description |
| category | VARCHAR(100) | Product category (WALLET, BAG, etc.) |
| is_active | BOOLEAN | Active status |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |
| created_by | INTEGER | User who created |
| updated_by | INTEGER | User who last updated |

**Indexes:**
- `idx_products_code` on product_code
- `idx_products_active` on is_active

---

### operations Table (Master Operations Library)

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| operation_code | VARCHAR(50) | Unique operation code (e.g., OP_001) |
| operation_name | VARCHAR(200) | Operation description |
| operation_description | TEXT | Detailed description |
| operation_category | VARCHAR(100) | Category (STITCHING, PASTING, etc.) |
| is_active | BOOLEAN | Active status |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |
| created_by | INTEGER | User who created |
| updated_by | INTEGER | User who last updated |

**Indexes:**
- `idx_operations_code` on operation_code
- `idx_operations_category` on operation_category
- `idx_operations_active` on is_active

**Purpose:** This is your MASTER library of ALL possible operations. When creating a new product, you select operations from this list and arrange them in sequence.

---

### product_processes Table (Product-Specific Process Flow)

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| product_id | INTEGER | Foreign key to products |
| operation_id | INTEGER | Foreign key to operations |
| workspace_id | INTEGER | Foreign key to workspaces (optional) |
| sequence_number | INTEGER | Order in process (1, 2, 3, ...) |
| operation_sah | DECIMAL(10,4) | SAH for this operation on this product |
| cycle_time_seconds | INTEGER | Cycle time in seconds |
| manpower_required | INTEGER | Number of workers needed |
| is_active | BOOLEAN | Active status |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |
| created_by | INTEGER | User who created |
| updated_by | INTEGER | User who last updated |

**Indexes:**
- `idx_product_processes_product` on product_id
- `idx_product_processes_operation` on operation_id
- `idx_product_processes_workspace` on workspace_id
- `idx_product_processes_sequence` on (product_id, sequence_number)

**Constraints:**
- `uq_product_sequence` UNIQUE (product_id, sequence_number)
- `chk_sah_positive` CHECK (operation_sah > 0)
- `chk_sequence_positive` CHECK (sequence_number > 0)

**Purpose:** Links products to operations in a specific sequence. Each product can have its own unique process flow by selecting and arranging operations from the master list.

---

### workspaces Table (Physical Workstations)

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| workspace_code | VARCHAR(50) | Unique workspace code |
| workspace_name | VARCHAR(100) | Workspace name |
| workspace_type | VARCHAR(50) | Type (MACHINE, MANUAL_STATION, QA_TABLE) |
| line_id | INTEGER | Foreign key to production_lines |
| qr_code_path | VARCHAR(255) | Path to QR code image |
| is_active | BOOLEAN | Active status |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |
| created_by | INTEGER | User who created |
| updated_by | INTEGER | User who last updated |

**Indexes:**
- `idx_workspaces_code` on workspace_code
- `idx_workspaces_line` on line_id
- `idx_workspaces_active` on is_active

**Purpose:** Represents physical locations where operations are performed. Can be linked to product_processes to specify WHERE each operation happens.

**Status:** Table created, ready for data when you have the actual workspace list.

---

## 🔄 HOW IT WORKS: Reusable Operations

### Concept

1. **Master Operations Library** (`operations` table)
   - Contains ALL possible operations used across ALL products
   - Each operation has a unique ID and code (e.g., OP_001, OP_002)
   - Operations are reusable across multiple products

2. **Product Definition** (`products` table)
   - Each product (wallet, bag, etc.) has basic info
   - Product Code, Name, Category

3. **Product Process Flow** (`product_processes` table)
   - Links a product to specific operations in a specific sequence
   - Same operation can be used by multiple products
   - Each product-operation combination has its own SAH (different products may have different complexity)

### Example Workflow

**Creating a New Product:**

1. Create product record:
   ```sql
   INSERT INTO products (product_code, product_name, category)
   VALUES ('CY406', 'BIFOLD WALLET', 'WALLET');
   ```

2. Define its process flow by selecting operations from master list:
   ```sql
   -- Step 1: Heating (use existing OP_028)
   INSERT INTO product_processes (product_id, operation_id, sequence_number, cycle_time_seconds, operation_sah, manpower_required)
   VALUES (2, 28, 1, 25, 0.0069, 1);

   -- Step 2: Cutting (use existing OP_009)
   INSERT INTO product_processes (product_id, operation_id, sequence_number, cycle_time_seconds, operation_sah, manpower_required)
   VALUES (2, 9, 2, 35, 0.0097, 1);

   -- Step 3: Stitching (use existing OP_007)
   INSERT INTO product_processes (product_id, operation_id, sequence_number, cycle_time_seconds, operation_sah, manpower_required)
   VALUES (2, 7, 3, 45, 0.0125, 1);
   ```

**Benefits:**
- ✅ Operations are standardized and reusable
- ✅ Easy to create new products by mixing existing operations
- ✅ Each product can have different SAH for same operation
- ✅ Can easily update operation names centrally
- ✅ Can track which products use which operations

---

## 🔍 SAMPLE QUERIES

### Get All Products with Their Process Flows

```sql
SELECT
    p.product_code,
    p.product_name,
    pp.sequence_number,
    o.operation_code,
    o.operation_name,
    pp.operation_sah,
    pp.cycle_time_seconds
FROM products p
JOIN product_processes pp ON p.id = pp.product_id
JOIN operations o ON pp.operation_id = o.id
WHERE p.is_active = true
ORDER BY p.product_code, pp.sequence_number;
```

### Calculate Total SAH for a Product

```sql
SELECT
    p.product_code,
    p.product_name,
    SUM(pp.operation_sah) as total_sah,
    COUNT(pp.id) as total_operations
FROM products p
JOIN product_processes pp ON p.id = pp.product_id
WHERE p.product_code = 'CY405'
GROUP BY p.id, p.product_code, p.product_name;
```

### Find Which Products Use a Specific Operation

```sql
SELECT
    o.operation_code,
    o.operation_name,
    p.product_code,
    p.product_name,
    pp.sequence_number
FROM operations o
JOIN product_processes pp ON o.id = pp.operation_id
JOIN products p ON pp.product_id = p.id
WHERE o.operation_code = 'OP_001'
ORDER BY p.product_code, pp.sequence_number;
```

### Get All Operations in a Category

```sql
SELECT
    operation_code,
    operation_name,
    operation_category
FROM operations
WHERE operation_category = 'STITCHING'
  AND is_active = true
ORDER BY operation_code;
```

### Add a New Product with Process Flow

```sql
-- 1. Insert product
INSERT INTO products (product_code, product_name, category)
VALUES ('CY407', 'CARD HOLDER', 'WALLET');

-- 2. Get the product ID
SELECT id FROM products WHERE product_code = 'CY407';

-- 3. Add operations in sequence (assume product_id = 3)
INSERT INTO product_processes (product_id, operation_id, sequence_number, cycle_time_seconds, operation_sah, manpower_required)
SELECT 3, id, 1, 15, 0.0042, 1 FROM operations WHERE operation_code = 'OP_001'
UNION ALL
SELECT 3, id, 2, 30, 0.0083, 1 FROM operations WHERE operation_code = 'OP_002'
UNION ALL
SELECT 3, id, 3, 25, 0.0069, 1 FROM operations WHERE operation_code = 'OP_007';
```

---

## ✅ VERIFICATION CHECKLIST

- [x] products table created
- [x] operations table created (master library)
- [x] workspaces table created (ready for data)
- [x] product_processes table created (links products to operations)
- [x] 71 master operations imported from GAFOOR LINE.xlsx
- [x] Sample product CY405 created
- [x] Sample process flow created (5 operations)
- [x] All indexes and constraints applied
- [x] Foreign keys properly set up
- [ ] Workspace data to be added when available
- [ ] Workspace QR codes to be generated when workspaces added

---

## 🔄 NEXT STEPS

### Phase 1: Additional Products
1. Import more products from other Excel sheets
2. Define process flows for each product
3. Link operations to workspaces (when workspace list available)

### Phase 2: Workspace Integration
1. Get actual workspace/machine list
2. Import workspaces with line assignments
3. Generate QR codes for each workspace
4. Link workspaces to product_processes

### Phase 3: Production Tracking Tables
1. Create daily_line_configuration (which products run today)
2. Create employee_assignments (link employees to operations)
3. Create hourly_production_logs (track output per operation)
4. Create material_issuance
5. Create qa_output

---

## 📞 Database Connection

```bash
PGPASSWORD='worksync_secure_2026' psql -h 127.0.0.1 -U worksync_user -d worksync_db
```

### Useful Commands

```sql
-- List all products
SELECT * FROM products;

-- List all operations
SELECT operation_code, operation_name, operation_category FROM operations ORDER BY operation_code;

-- View a product's complete process
SELECT
    pp.sequence_number,
    o.operation_code,
    o.operation_name,
    pp.operation_sah,
    pp.cycle_time_seconds
FROM product_processes pp
JOIN operations o ON pp.operation_id = o.id
WHERE pp.product_id = 1
ORDER BY pp.sequence_number;

-- Count operations by category
SELECT operation_category, COUNT(*)
FROM operations
GROUP BY operation_category
ORDER BY COUNT(*) DESC;
```

---

## 📝 IMPORTANT NOTES

1. **Operations are Reusable:** The same operation (e.g., "Stitching") can be used by multiple products with different SAH values

2. **Product-Specific SAH:** Each product has its own SAH for each operation based on complexity

3. **Sequence Matters:** The sequence_number defines the order of operations in the manufacturing process

4. **Soft Delete:** Use `is_active = false` instead of deleting records

5. **Workspace Linking:** Once workspaces are added, link them to product_processes to specify WHERE each operation happens

6. **SAH Calculation:** SAH = Cycle Time (seconds) / 3600

---

**Setup completed successfully!**
**Products and operations database is ready for WorkSync production tracking system.**

For detailed documentation, see:
- System setup: `~/worksync/RASPBERRY_PI_SETUP.md`
- Employee database: `~/worksync/EMPLOYEE_DATABASE_SUMMARY.md`
- **This document:** `~/worksync/PRODUCTS_DATABASE_SUMMARY.md`
