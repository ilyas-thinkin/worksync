/**
 * WorkSync Session Management Middleware
 * Handles session timeout, security headers, and rate limiting
 */

const crypto = require('crypto');

// Session configuration
const SESSION_CONFIG = {
    maxAge: 8 * 60 * 60 * 1000,      // 8 hours default
    idleTimeout: 30 * 60 * 1000,     // 30 minutes idle timeout
    renewalThreshold: 60 * 60 * 1000, // Renew if less than 1 hour left
    maxSessions: 5,                   // Max sessions per user
    secure: process.env.NODE_ENV === 'production'
};

// In-memory session store (replace with Redis for production scaling)
const sessionStore = new Map();
const userSessions = new Map(); // Track sessions per user

/**
 * Generate session ID
 */
function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new session
 * @param {Object} user - User data
 * @param {string} ipAddress - Client IP
 * @param {string} userAgent - Client user agent
 */
function createSession(user, ipAddress, userAgent) {
    const sessionId = generateSessionId();
    const now = Date.now();

    const session = {
        id: sessionId,
        userId: user.id,
        username: user.username,
        role: user.role,
        createdAt: now,
        lastActivity: now,
        expiresAt: now + SESSION_CONFIG.maxAge,
        ipAddress,
        userAgent: userAgent?.substring(0, 200)
    };

    // Store session
    sessionStore.set(sessionId, session);

    // Track user sessions
    if (!userSessions.has(user.id)) {
        userSessions.set(user.id, new Set());
    }
    const userSessionSet = userSessions.get(user.id);
    userSessionSet.add(sessionId);

    // Enforce max sessions per user
    if (userSessionSet.size > SESSION_CONFIG.maxSessions) {
        // Remove oldest session
        const oldestSession = findOldestSession(userSessionSet);
        if (oldestSession) {
            destroySession(oldestSession);
        }
    }

    return session;
}

/**
 * Find oldest session from a set
 */
function findOldestSession(sessionIds) {
    let oldest = null;
    let oldestTime = Infinity;

    for (const id of sessionIds) {
        const session = sessionStore.get(id);
        if (session && session.createdAt < oldestTime) {
            oldest = id;
            oldestTime = session.createdAt;
        }
    }

    return oldest;
}

/**
 * Get session by ID
 * @param {string} sessionId
 */
function getSession(sessionId) {
    return sessionStore.get(sessionId);
}

/**
 * Update session activity
 * @param {string} sessionId
 */
function touchSession(sessionId) {
    const session = sessionStore.get(sessionId);
    if (session) {
        session.lastActivity = Date.now();
    }
    return session;
}

/**
 * Destroy a session
 * @param {string} sessionId
 */
function destroySession(sessionId) {
    const session = sessionStore.get(sessionId);
    if (session) {
        // Remove from user sessions
        const userSessionSet = userSessions.get(session.userId);
        if (userSessionSet) {
            userSessionSet.delete(sessionId);
            if (userSessionSet.size === 0) {
                userSessions.delete(session.userId);
            }
        }
        // Remove session
        sessionStore.delete(sessionId);
    }
}

/**
 * Destroy all sessions for a user
 * @param {number} userId
 */
function destroyUserSessions(userId) {
    const userSessionSet = userSessions.get(userId);
    if (userSessionSet) {
        for (const sessionId of userSessionSet) {
            sessionStore.delete(sessionId);
        }
        userSessions.delete(userId);
    }
}

/**
 * Check if session is valid
 * @param {Object} session
 */
function isSessionValid(session) {
    if (!session) return false;

    const now = Date.now();

    // Check expiration
    if (now > session.expiresAt) {
        return false;
    }

    // Check idle timeout
    if (now - session.lastActivity > SESSION_CONFIG.idleTimeout) {
        return false;
    }

    return true;
}

/**
 * Check if session needs renewal
 * @param {Object} session
 */
function needsRenewal(session) {
    if (!session) return false;
    const timeLeft = session.expiresAt - Date.now();
    return timeLeft < SESSION_CONFIG.renewalThreshold;
}

/**
 * Renew session
 * @param {string} sessionId
 */
function renewSession(sessionId) {
    const session = sessionStore.get(sessionId);
    if (session) {
        session.expiresAt = Date.now() + SESSION_CONFIG.maxAge;
        session.lastActivity = Date.now();
    }
    return session;
}

/**
 * Get all active sessions for a user
 * @param {number} userId
 */
function getUserActiveSessions(userId) {
    const userSessionSet = userSessions.get(userId);
    if (!userSessionSet) return [];

    const sessions = [];
    for (const sessionId of userSessionSet) {
        const session = sessionStore.get(sessionId);
        if (session && isSessionValid(session)) {
            sessions.push({
                id: session.id,
                createdAt: session.createdAt,
                lastActivity: session.lastActivity,
                ipAddress: session.ipAddress,
                userAgent: session.userAgent
            });
        }
    }

    return sessions;
}

/**
 * Clean up expired sessions (run periodically)
 */
function cleanupExpiredSessions() {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of sessionStore) {
        if (!isSessionValid(session)) {
            destroySession(sessionId);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`Session cleanup: removed ${cleaned} expired sessions`);
    }

    return cleaned;
}

/**
 * Session validation middleware
 */
function sessionMiddleware(req, res, next) {
    // Get session ID from cookie or header
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id'];

    if (!sessionId) {
        req.session = null;
        return next();
    }

    const session = getSession(sessionId);

    if (!session || !isSessionValid(session)) {
        // Invalid or expired session
        destroySession(sessionId);
        req.session = null;

        // Clear cookie
        res.setHeader('Set-Cookie', 'sessionId=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');

        return next();
    }

    // Update activity
    touchSession(sessionId);

    // Check if renewal needed
    if (needsRenewal(session)) {
        renewSession(sessionId);
    }

    // Attach session to request
    req.session = session;
    req.user = {
        id: session.userId,
        username: session.username,
        role: session.role
    };

    next();
}

/**
 * Security headers middleware
 */
function securityHeaders(req, res, next) {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Content Security Policy (adjust as needed)
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: blob:; " +
        "connect-src 'self';"
    );

    // Strict Transport Security (HTTPS only)
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
}

/**
 * Simple in-memory rate limiter
 */
const rateLimitStore = new Map();

function rateLimiter(options = {}) {
    const {
        windowMs = 15 * 60 * 1000, // 15 minutes
        max = 100,                  // Max requests per window
        message = 'Too many requests, please try again later',
        keyGenerator = (req) => req.ip || req.connection.remoteAddress
    } = options;

    // Clean up old entries periodically
    setInterval(() => {
        const now = Date.now();
        for (const [key, data] of rateLimitStore) {
            if (now > data.resetAt) {
                rateLimitStore.delete(key);
            }
        }
    }, windowMs);

    return (req, res, next) => {
        const key = keyGenerator(req);
        const now = Date.now();

        let data = rateLimitStore.get(key);

        if (!data || now > data.resetAt) {
            data = {
                count: 0,
                resetAt: now + windowMs
            };
            rateLimitStore.set(key, data);
        }

        data.count++;

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - data.count));
        res.setHeader('X-RateLimit-Reset', Math.ceil(data.resetAt / 1000));

        if (data.count > max) {
            return res.status(429).json({
                success: false,
                error: message,
                retryAfter: Math.ceil((data.resetAt - now) / 1000)
            });
        }

        next();
    };
}

/**
 * Login rate limiter (stricter)
 */
const loginRateLimiter = rateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,                    // 5 attempts
    message: 'Too many login attempts, please try again in 15 minutes',
    keyGenerator: (req) => `login:${req.ip || req.connection.remoteAddress}`
});

// Start cleanup interval
setInterval(cleanupExpiredSessions, 5 * 60 * 1000); // Every 5 minutes

module.exports = {
    SESSION_CONFIG,
    createSession,
    getSession,
    touchSession,
    destroySession,
    destroyUserSessions,
    isSessionValid,
    renewSession,
    getUserActiveSessions,
    cleanupExpiredSessions,
    sessionMiddleware,
    securityHeaders,
    rateLimiter,
    loginRateLimiter
};
