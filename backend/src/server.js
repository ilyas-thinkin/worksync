require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { execFile } = require('child_process');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const cron = require('node-cron');
const realtime = require('./realtime');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

const FORCE_HTTPS = ['1', 'true', 'yes'].includes(String(process.env.FORCE_HTTPS || '').toLowerCase());
const FORCE_HTTPS_PORT = process.env.FORCE_HTTPS_PORT || '';
if (FORCE_HTTPS) {
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto !== 'https') {
      const host = req.headers.host || '';
      const targetHost = FORCE_HTTPS_PORT
        ? host.replace(/:\d+$/, `:${FORCE_HTTPS_PORT}`)
        : host;
      return res.redirect(301, `https://${targetHost}${req.originalUrl}`);
    }
    next();
  });
}

const AUTH_SECRET = process.env.AUTH_SECRET || process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const AUTH_COOKIE = 'worksync_auth';
const ROLE_PASSWORDS = {
  admin: 'admin1234',
  ie: 'ie1234',
  supervisor: 'sup1234',
  management: 'manage1234'
};

const parseCookies = (cookieHeader = '') => {
  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
};

const TOKEN_MAX_AGE_SEC = 12 * 60 * 60; // 12 hours — one full shift + buffer

const signToken = (payload) => {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + TOKEN_MAX_AGE_SEC };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const data = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  return `${data}.${signature}`;
};

const verifyToken = (token) => {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const data = `${header}.${body}`;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  if (expected !== signature) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    // Reject expired tokens
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch (err) {
    return null;
  }
};

const isHttpsRequest = (req) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return proto === 'https';
};

const buildAuthCookie = (token, req, { clear = false } = {}) => {
  const parts = [
    `${AUTH_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${TOKEN_MAX_AGE_SEC}`  // persist for full shift
  ];
  if (isHttpsRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
};

const requireRole = (role) => (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const payload = verifyToken(cookies[AUTH_COOKIE]);
  if (!payload || payload.role !== role) {
    return res.status(401).redirect('/');
  }
  req.user = payload;
  next();
};

const requireAnyRole = (roles) => (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const payload = verifyToken(cookies[AUTH_COOKIE]);
  if (!payload || (roles && !roles.includes(payload.role))) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  req.user = payload;
  next();
};

// Block direct access to protected HTML files
app.use((req, res, next) => {
  const blocked = ['/admin.html', '/ie.html', '/supervisor.html', '/management.html'];
  if (blocked.includes(req.path)) {
    return res.redirect('/');
  }
  next();
});

// Serve static files (public assets)
app.use(express.static(path.join(__dirname, 'public')));
// Serve QR code images
app.use('/qrcodes', express.static(process.env.QRCODES_DIR || path.join(__dirname, '..', '..', 'qrcodes')));

// Realtime updates (SSE)
app.get('/events', requireAnyRole(['admin', 'ie', 'supervisor', 'management']), realtime.handleEvents);
realtime.startDbListener();

// API Routes
const apiRoutes = require('./routes/api.routes');
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', (req, res, next) => {
  // Allow product export/template downloads without auth
  if (req.path.startsWith('/products/export/') || req.path === '/products/upload-template') {
    return next();
  }
  if (req.path.startsWith('/users') || req.path.startsWith('/production-days') || req.path.startsWith('/audit-logs')) {
    return requireAnyRole(['admin'])(req, res, next);
  }
  if (req.path.startsWith('/line-shifts')) {
    return requireAnyRole(['admin'])(req, res, next);
  }
  if (req.path.startsWith('/reports')) {
    return requireAnyRole(['admin', 'management'])(req, res, next);
  }
  if (req.path.startsWith('/daily-plans') || req.path.startsWith('/ie') || req.path.startsWith('/settings')) {
    return requireAnyRole(['ie', 'admin'])(req, res, next);
  }
  if (req.path.startsWith('/workstations')) {
    if (req.method === 'GET') {
      return requireAnyRole(['admin', 'ie', 'supervisor', 'management'])(req, res, next);
    }
    return requireAnyRole(['admin', 'ie'])(req, res, next);
  }
  if (req.path.startsWith('/supervisor/shift-summary')) {
    return requireAnyRole(['supervisor', 'admin', 'management', 'ie'])(req, res, next);
  }
  if (req.path.startsWith('/supervisor/employee-hourly-efficiency')) {
    return requireAnyRole(['supervisor', 'admin', 'management', 'ie'])(req, res, next);
  }
  if (req.path.startsWith('/supervisor/hourly-remarks')) {
    return requireAnyRole(['supervisor', 'admin', 'management', 'ie'])(req, res, next);
  }
  if (req.path.startsWith('/supervisor') && req.method === 'GET') {
    return requireAnyRole(['supervisor', 'admin', 'management'])(req, res, next);
  }
  if (req.path.startsWith('/supervisor') || req.path.startsWith('/line-metrics')) {
    return requireAnyRole(['supervisor', 'admin'])(req, res, next);
  }
  return requireAnyRole(['admin', 'ie', 'supervisor', 'management'])(req, res, next);
});
app.use('/api', apiRoutes);

// Auth routes
app.post('/auth/login', (req, res) => {
  const { role, password } = req.body || {};
  if (!ROLE_PASSWORDS[role]) {
    return res.status(400).json({ success: false, error: 'Invalid role' });
  }
  if (ROLE_PASSWORDS[role] !== password) {
    return res.status(401).json({ success: false, error: 'Invalid password' });
  }
  const token = signToken({ role });
  res.setHeader('Set-Cookie', buildAuthCookie(token, req));
  const redirectMap = {
    admin: '/admin',
    ie: '/ie',
    supervisor: '/supervisor',
    management: '/management'
  };
  res.json({ success: true, redirect: redirectMap[role] || '/' });
});

app.get('/auth/session', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const payload = verifyToken(cookies[AUTH_COOKIE]);
  if (!payload) {
    return res.status(401).json({ success: false });
  }
  res.json({ success: true, role: payload.role });
});

app.post('/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', buildAuthCookie('', req, { clear: true }));
  res.json({ success: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'WorkSync server is running',
    time: new Date()
  });
});

// Admin page
app.get('/admin', requireRole('admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// IE page
app.get('/ie', requireRole('ie'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ie.html'));
});

// Line supervisor page
app.get('/supervisor', requireRole('supervisor'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'supervisor.html'));
});

// Management page
app.get('/management', requireAnyRole(['admin', 'ie', 'supervisor', 'management']), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'management.html'));
});

// Serve login page for all other routes (Express 5 syntax)
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const httpServer = app.listen(PORT, HOST, () => {
  console.log(`✅ WorkSync server running on http://${HOST}:${PORT}`);
  console.log(`📊 Admin Panel: http://localhost:${PORT}`);
  setupSystemdNotify();
});
// Keep connections alive for 65s (longer than any SSE keep-alive interval of 25s)
// and allow up to 120s for slow uploads/reports
httpServer.keepAliveTimeout = 65000;
httpServer.headersTimeout   = 120000;

const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const certPath = process.env.HTTPS_CERT_PATH || path.join(__dirname, '..', '..', 'certs', 'worksync.crt');
const keyPath = process.env.HTTPS_KEY_PATH || path.join(__dirname, '..', '..', 'certs', 'worksync.key');

// Only start HTTPS on the first cluster instance to avoid EADDRINUSE
let httpsServer = null;
const instanceId = parseInt(process.env.NODE_APP_INSTANCE || '0', 10);

// 8 AM reset — runs only on PM2 instance 0 to avoid duplicate executions.
// At 08:00 every day, set is_linked = false for ALL assignments (regular + OT)
// so supervisors must re-map employees fresh at the start of each shift.
if (instanceId === 0) {
  const pool = require('./config/db.config');
  cron.schedule('0 8 * * *', async () => {
    try {
      const result = await pool.query(
        `UPDATE employee_workstation_assignments
         SET is_linked = false
         WHERE is_linked = true`
      );
      console.log(`[8AM Reset] Unlinked ${result.rowCount} employee-workstation mappings.`);
      realtime.broadcast('data_change', { entity: 'workstation_assignments', action: 'morning_reset' });
    } catch (err) {
      console.error('[8AM Reset] Failed to unlink mappings:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });
  console.log('⏰ 8AM mapping reset scheduled (instance 0).');
}
if (instanceId === 0 && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const options = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
  };
  httpsServer = https.createServer(options, app);
  httpsServer.keepAliveTimeout = 65000;
  httpsServer.headersTimeout   = 120000;
  httpsServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`HTTPS port ${HTTPS_PORT} in use, HTTPS disabled for this instance.`);
      httpsServer = null;
    } else {
      console.error('HTTPS server error:', err);
    }
  });
  httpsServer.listen(HTTPS_PORT, HOST, () => {
    console.log(`🔒 HTTPS enabled on https://${HOST}:${HTTPS_PORT}`);
  });
} else if (instanceId === 0) {
  console.warn('HTTPS certs not found; HTTPS server not started.');
}

function setupSystemdNotify() {
  const notifySocket = process.env.NOTIFY_SOCKET;
  if (!notifySocket) return;

  const send = (args) => {
    execFile('/usr/bin/systemd-notify', args, { env: process.env }, () => {
      // best-effort notify
    });
  };

  send(['--ready']);

  const watchdogUsec = parseInt(process.env.WATCHDOG_USEC || '0', 10);
  if (watchdogUsec > 0) {
    const intervalMs = Math.max(1000, Math.floor(watchdogUsec / 2000));
    setInterval(() => send(['--watchdog']), intervalMs).unref();
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN HANDLING (PM2 Cluster Mode)
// ============================================================================
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n⚠️  Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  httpServer.close((err) => {
    if (err) {
      console.error('Error closing HTTP server:', err);
    } else {
      console.log('✅ HTTP server closed');
    }
  });

  if (httpsServer) {
    httpsServer.close((err) => {
      if (err) {
        console.error('Error closing HTTPS server:', err);
      } else {
        console.log('✅ HTTPS server closed');
      }
    });
  }

  // Close database pool
  try {
    const pool = require('./config/db.config');
    await pool.end();
    console.log('✅ Database pool closed');
  } catch (err) {
    console.error('Error closing database pool:', err);
  }

  // Close SSE connections
  try {
    realtime.closeAllConnections();
    console.log('✅ SSE connections closed');
  } catch (err) {
    // realtime may not have closeAllConnections
  }

  // Give some time for cleanup
  setTimeout(() => {
    console.log('👋 Shutdown complete. Goodbye!');
    process.exit(0);
  }, 1000);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions (log and exit)
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// PM2 graceful reload
process.on('message', (msg) => {
  if (msg === 'shutdown') {
    gracefulShutdown('PM2 shutdown');
  }
});
