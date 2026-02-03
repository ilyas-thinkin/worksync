/**
 * WorkSync Input Validation Middleware
 * Uses Zod for schema validation
 */

const { z } = require('zod');

// =====================================================
// COMMON SCHEMAS
// =====================================================

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)');
const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:MM)').optional();
const empCode = z.string().min(1).max(50);
const lineCode = z.string().min(1).max(20);
const productCode = z.string().min(1).max(50);
const operationCode = z.string().min(1).max(50);

// =====================================================
// USER & AUTH SCHEMAS
// =====================================================

const userSchema = z.object({
    username: z.string().min(3).max(50),
    password: z.string().min(4).max(100),
    role: z.enum(['admin', 'ie', 'supervisor', 'management'])
});

const loginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1)
});

// =====================================================
// PRODUCTION LINE SCHEMAS
// =====================================================

const lineSchema = z.object({
    line_code: lineCode,
    line_name: z.string().min(1).max(100),
    is_active: z.boolean().optional()
});

// =====================================================
// EMPLOYEE SCHEMAS
// =====================================================

const employeeSchema = z.object({
    emp_code: empCode,
    emp_name: z.string().min(1).max(100),
    line_id: positiveInt.nullable().optional(),
    is_active: z.boolean().optional()
});

const attendanceSchema = z.object({
    employee_id: positiveInt,
    attendance_date: dateString,
    in_time: timeString,
    out_time: timeString,
    status: z.enum(['present', 'absent', 'late', 'half-day']).optional()
});

// =====================================================
// PRODUCT & OPERATION SCHEMAS
// =====================================================

const productSchema = z.object({
    product_code: productCode,
    product_name: z.string().min(1).max(200),
    is_active: z.boolean().optional()
});

const operationSchema = z.object({
    operation_code: operationCode,
    operation_name: z.string().min(1).max(200),
    operation_category: z.string().min(1).max(50).optional(),
    is_active: z.boolean().optional()
});

const processAssignmentSchema = z.object({
    product_id: positiveInt,
    operation_id: positiveInt,
    sequence_number: positiveInt,
    operation_sah: z.number().positive().max(999.99),
    planned_manpower: positiveInt.optional()
});

// =====================================================
// DAILY PLAN SCHEMAS
// =====================================================

const dailyPlanSchema = z.object({
    line_id: positiveInt,
    work_date: dateString,
    product_id: positiveInt,
    target_quantity: positiveInt,
    working_minutes: positiveInt.min(1).max(720).optional()
});

const dailyPlanUpdateSchema = z.object({
    target_quantity: positiveInt.optional(),
    working_minutes: positiveInt.min(1).max(720).optional(),
    product_id: positiveInt.optional()
});

// =====================================================
// PROGRESS & PRODUCTION SCHEMAS
// =====================================================

const hourlyProgressSchema = z.object({
    line_id: positiveInt,
    process_id: positiveInt,
    work_date: dateString,
    hour_slot: z.number().int().min(8).max(19),
    quantity: nonNegativeInt
});

const progressUpdateSchema = z.object({
    quantity: nonNegativeInt
});

const employeeAssignmentSchema = z.object({
    line_id: positiveInt,
    process_id: positiveInt,
    employee_id: positiveInt.nullable(),
    work_date: dateString.optional()
});

// =====================================================
// MATERIAL TRACKING SCHEMAS
// =====================================================

const materialTransactionSchema = z.object({
    line_id: positiveInt,
    work_date: dateString,
    transaction_type: z.enum(['input', 'output', 'adjustment']),
    quantity: z.number().int(),
    notes: z.string().max(500).optional()
});

const materialStockSchema = z.object({
    line_id: positiveInt,
    work_date: dateString,
    opening_stock: nonNegativeInt.optional(),
    input_qty: nonNegativeInt.optional(),
    output_qty: nonNegativeInt.optional()
});

// =====================================================
// SHIFT & METRICS SCHEMAS
// =====================================================

const shiftCloseSchema = z.object({
    line_id: positiveInt,
    work_date: dateString,
    qa_output: nonNegativeInt.optional(),
    notes: z.string().max(1000).optional()
});

const metricsUpdateSchema = z.object({
    qa_output: nonNegativeInt.optional(),
    total_output: nonNegativeInt.optional(),
    notes: z.string().max(1000).optional()
});

// =====================================================
// QUERY PARAMETER SCHEMAS
// =====================================================

const dateQuerySchema = z.object({
    work_date: dateString.optional(),
    date: dateString.optional()
}).refine(data => data.work_date || data.date, {
    message: 'Either work_date or date is required'
});

const lineQuerySchema = z.object({
    line_id: z.string().regex(/^\d+$/).transform(Number).optional()
});

const paginationSchema = z.object({
    page: z.string().regex(/^\d+$/).transform(Number).optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).optional()
});

// =====================================================
// VALIDATION MIDDLEWARE FACTORY
// =====================================================

/**
 * Creates validation middleware for request body
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {Function} Express middleware
 */
function validateBody(schema) {
    return (req, res, next) => {
        try {
            req.body = schema.parse(req.body);
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: error.errors.map(e => ({
                        field: e.path.join('.'),
                        message: e.message
                    }))
                });
            }
            next(error);
        }
    };
}

/**
 * Creates validation middleware for query parameters
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {Function} Express middleware
 */
function validateQuery(schema) {
    return (req, res, next) => {
        try {
            req.query = schema.parse(req.query);
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    error: 'Invalid query parameters',
                    details: error.errors.map(e => ({
                        field: e.path.join('.'),
                        message: e.message
                    }))
                });
            }
            next(error);
        }
    };
}

/**
 * Creates validation middleware for URL parameters
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {Function} Express middleware
 */
function validateParams(schema) {
    return (req, res, next) => {
        try {
            req.params = schema.parse(req.params);
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    error: 'Invalid URL parameters',
                    details: error.errors.map(e => ({
                        field: e.path.join('.'),
                        message: e.message
                    }))
                });
            }
            next(error);
        }
    };
}

/**
 * Sanitizes string inputs to prevent XSS
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/[<>]/g, '') // Remove < and >
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/on\w+=/gi, '') // Remove event handlers
        .trim();
}

/**
 * Middleware to sanitize all string inputs in request body
 */
function sanitizeInputs(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        for (const key in req.body) {
            if (typeof req.body[key] === 'string') {
                req.body[key] = sanitizeString(req.body[key]);
            }
        }
    }
    next();
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
    // Schemas
    schemas: {
        user: userSchema,
        login: loginSchema,
        line: lineSchema,
        employee: employeeSchema,
        attendance: attendanceSchema,
        product: productSchema,
        operation: operationSchema,
        processAssignment: processAssignmentSchema,
        dailyPlan: dailyPlanSchema,
        dailyPlanUpdate: dailyPlanUpdateSchema,
        hourlyProgress: hourlyProgressSchema,
        progressUpdate: progressUpdateSchema,
        employeeAssignment: employeeAssignmentSchema,
        materialTransaction: materialTransactionSchema,
        materialStock: materialStockSchema,
        shiftClose: shiftCloseSchema,
        metricsUpdate: metricsUpdateSchema,
        dateQuery: dateQuerySchema,
        lineQuery: lineQuerySchema,
        pagination: paginationSchema
    },

    // Middleware factories
    validateBody,
    validateQuery,
    validateParams,
    sanitizeInputs,

    // Common validators
    validators: {
        positiveInt,
        nonNegativeInt,
        dateString,
        timeString,
        empCode,
        lineCode,
        productCode,
        operationCode
    }
};
