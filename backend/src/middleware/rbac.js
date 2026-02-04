/**
 * WorkSync Role-Based Access Control (RBAC) Middleware
 * Provides granular permission control for API endpoints
 */

// Role hierarchy (higher includes lower permissions)
const ROLE_HIERARCHY = {
    admin: 4,
    ie: 3,
    supervisor: 2,
    management: 1
};

// Permission definitions
const PERMISSIONS = {
    // User management
    'users:read': ['admin'],
    'users:create': ['admin'],
    'users:update': ['admin'],
    'users:delete': ['admin'],

    // Production lines
    'lines:read': ['admin', 'ie', 'supervisor', 'management'],
    'lines:create': ['admin'],
    'lines:update': ['admin'],
    'lines:delete': ['admin'],

    // Employees
    'employees:read': ['admin', 'ie', 'supervisor', 'management'],
    'employees:create': ['admin'],
    'employees:update': ['admin'],
    'employees:delete': ['admin'],

    // Products
    'products:read': ['admin', 'ie', 'supervisor', 'management'],
    'products:create': ['admin'],
    'products:update': ['admin'],
    'products:delete': ['admin'],

    // Operations
    'operations:read': ['admin', 'ie', 'supervisor', 'management'],
    'operations:create': ['admin'],
    'operations:update': ['admin'],
    'operations:delete': ['admin'],

    // Product processes
    'processes:read': ['admin', 'ie', 'supervisor', 'management'],
    'processes:create': ['admin'],
    'processes:update': ['admin', 'ie'],
    'processes:delete': ['admin'],

    // Daily plans
    'daily-plans:read': ['admin', 'ie', 'supervisor', 'management'],
    'daily-plans:create': ['admin', 'ie'],
    'daily-plans:update': ['admin', 'ie'],
    'daily-plans:lock': ['admin', 'ie'],

    // Attendance
    'attendance:read': ['admin', 'ie', 'supervisor', 'management'],
    'attendance:update': ['admin', 'ie'],

    // Production day locks
    'day-locks:read': ['admin', 'ie', 'management'],
    'day-locks:lock': ['admin'],
    'day-locks:unlock': ['admin'],

    // Line metrics
    'line-metrics:read': ['admin', 'ie', 'supervisor', 'management'],
    'line-metrics:update': ['admin', 'ie', 'supervisor'],

    // Hourly progress
    'progress:read': ['admin', 'ie', 'supervisor', 'management'],
    'progress:update': ['admin', 'supervisor'],

    // Materials
    'materials:read': ['admin', 'ie', 'supervisor', 'management'],
    'materials:update': ['admin', 'supervisor'],

    // Shift operations
    'shift:close': ['admin', 'supervisor'],
    'shift:unlock': ['admin'],

    // Reports
    'reports:read': ['admin', 'ie', 'management'],
    'reports:export': ['admin', 'ie', 'management'],

    // Audit logs
    'audit:read': ['admin'],
    'audit:search': ['admin'],

    // Settings
    'settings:read': ['admin', 'ie'],
    'settings:update': ['admin', 'ie'],

    // Assignments
    'assignments:read': ['admin', 'ie', 'supervisor'],
    'assignments:update': ['admin', 'supervisor'],

    // Dashboard
    'dashboard:read': ['admin', 'ie', 'supervisor', 'management']
};

// Route to permission mapping
const ROUTE_PERMISSIONS = {
    // Users
    'GET /api/users': 'users:read',
    'POST /api/users': 'users:create',
    'PUT /api/users/:id': 'users:update',
    'DELETE /api/users/:id': 'users:delete',

    // Lines
    'GET /api/lines': 'lines:read',
    'POST /api/lines': 'lines:create',
    'PUT /api/lines/:id': 'lines:update',
    'DELETE /api/lines/:id': 'lines:delete',

    // Employees
    'GET /api/employees': 'employees:read',
    'POST /api/employees': 'employees:create',
    'PUT /api/employees/:id': 'employees:update',
    'DELETE /api/employees/:id': 'employees:delete',

    // Products
    'GET /api/products': 'products:read',
    'POST /api/products': 'products:create',
    'PUT /api/products/:id': 'products:update',
    'DELETE /api/products/:id': 'products:delete',

    // Operations
    'GET /api/operations': 'operations:read',
    'POST /api/operations': 'operations:create',
    'PUT /api/operations/:id': 'operations:update',
    'DELETE /api/operations/:id': 'operations:delete',

    // Daily plans
    'GET /api/daily-plans': 'daily-plans:read',
    'POST /api/daily-plans': 'daily-plans:create',
    'POST /api/daily-plans/lock': 'daily-plans:lock',
    'POST /api/daily-plans/unlock': 'daily-plans:lock',

    // Attendance
    'GET /api/ie/attendance': 'attendance:read',
    'POST /api/ie/attendance': 'attendance:update',

    // Production day locks
    'GET /api/production-days': 'day-locks:read',
    'POST /api/production-days/lock': 'day-locks:lock',
    'POST /api/production-days/unlock': 'day-locks:unlock',

    // Line metrics
    'GET /api/line-metrics': 'line-metrics:read',
    'POST /api/line-metrics': 'line-metrics:update',

    // Progress
    'POST /api/supervisor/progress': 'progress:update',

    // Materials
    'POST /api/supervisor/materials': 'materials:update',

    // Shift
    'POST /api/supervisor/close-shift': 'shift:close',
    'POST /api/line-shifts/unlock': 'shift:unlock',

    // Reports
    'GET /api/reports/daily': 'reports:read',
    'GET /api/reports/range': 'reports:read',

    // Audit
    'GET /api/audit-logs': 'audit:read',
    'GET /api/audit-logs/summary': 'audit:read',
    'GET /api/audit-logs/search': 'audit:search',

    // Settings
    'GET /api/settings': 'settings:read',
    'PUT /api/settings': 'settings:update',

    // Assignments
    'POST /api/supervisor/assign': 'assignments:update',

    // Dashboard
    'GET /api/dashboard/stats': 'dashboard:read'
};

/**
 * Check if a role has a specific permission
 * @param {string} role - User role
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
function hasPermission(role, permission) {
    const allowedRoles = PERMISSIONS[permission];
    if (!allowedRoles) {
        // If permission not defined, deny by default
        return false;
    }
    return allowedRoles.includes(role);
}

/**
 * Check if role1 is higher or equal to role2 in hierarchy
 * @param {string} role1 - First role
 * @param {string} role2 - Second role
 * @returns {boolean}
 */
function isRoleHigherOrEqual(role1, role2) {
    return (ROLE_HIERARCHY[role1] || 0) >= (ROLE_HIERARCHY[role2] || 0);
}

/**
 * Get all permissions for a role
 * @param {string} role - User role
 * @returns {string[]}
 */
function getRolePermissions(role) {
    const permissions = [];
    for (const [perm, roles] of Object.entries(PERMISSIONS)) {
        if (roles.includes(role)) {
            permissions.push(perm);
        }
    }
    return permissions;
}

/**
 * RBAC middleware - checks permission based on route
 * @param {Object} options - Options
 * @param {boolean} options.strict - If true, deny if route not mapped
 * @returns {Function} Express middleware
 */
function rbacMiddleware(options = { strict: false }) {
    return (req, res, next) => {
        // Skip auth routes
        if (req.path.startsWith('/auth')) {
            return next();
        }

        // Get user from request (set by auth middleware)
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        // Build route key
        const routeKey = `${req.method} ${req.route?.path || req.path}`;

        // Find matching permission
        let permission = ROUTE_PERMISSIONS[routeKey];

        // Try without params for parameterized routes
        if (!permission) {
            const pathWithoutParams = req.path.replace(/\/\d+/g, '/:id');
            const altKey = `${req.method} ${pathWithoutParams}`;
            permission = ROUTE_PERMISSIONS[altKey];
        }

        // If no permission defined and not strict, allow
        if (!permission) {
            if (options.strict) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied: Route not configured'
                });
            }
            return next();
        }

        // Check permission
        if (!hasPermission(user.role, permission)) {
            return res.status(403).json({
                success: false,
                error: `Access denied: Requires ${permission} permission`
            });
        }

        next();
    };
}

/**
 * Require specific permission middleware
 * @param {string} permission - Permission required
 * @returns {Function} Express middleware
 */
function requirePermission(permission) {
    return (req, res, next) => {
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        if (!hasPermission(user.role, permission)) {
            return res.status(403).json({
                success: false,
                error: `Access denied: Requires ${permission} permission`
            });
        }

        next();
    };
}

/**
 * Require one of multiple roles middleware
 * @param {string[]} roles - Allowed roles
 * @returns {Function} Express middleware
 */
function requireRole(...roles) {
    return (req, res, next) => {
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        if (!roles.includes(user.role)) {
            return res.status(403).json({
                success: false,
                error: `Access denied: Requires one of [${roles.join(', ')}] roles`
            });
        }

        next();
    };
}

/**
 * Require minimum role level middleware
 * @param {string} minRole - Minimum required role
 * @returns {Function} Express middleware
 */
function requireMinRole(minRole) {
    return (req, res, next) => {
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        if (!isRoleHigherOrEqual(user.role, minRole)) {
            return res.status(403).json({
                success: false,
                error: `Access denied: Requires ${minRole} or higher role`
            });
        }

        next();
    };
}

module.exports = {
    PERMISSIONS,
    ROLE_HIERARCHY,
    ROUTE_PERMISSIONS,
    hasPermission,
    isRoleHigherOrEqual,
    getRolePermissions,
    rbacMiddleware,
    requirePermission,
    requireRole,
    requireMinRole
};
