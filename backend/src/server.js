require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { execFile } = require('child_process');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const realtime = require('./realtime');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
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

const signToken = (payload) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
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
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
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
  if (req.path.startsWith('/users') || req.path.startsWith('/production-days') || req.path.startsWith('/audit-logs')) {
    return requireAnyRole(['admin'])(req, res, next);
  }
  if (req.path.startsWith('/daily-plans') || req.path.startsWith('/ie') || req.path.startsWith('/settings')) {
    return requireAnyRole(['ie', 'admin'])(req, res, next);
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
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`);
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
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`);
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
app.get('/management', requireRole('management'), (req, res) => {
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

const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const certPath = process.env.HTTPS_CERT_PATH || path.join(__dirname, '..', '..', 'certs', 'worksync.crt');
const keyPath = process.env.HTTPS_KEY_PATH || path.join(__dirname, '..', '..', 'certs', 'worksync.key');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const options = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
  };
  https.createServer(options, app).listen(HTTPS_PORT, HOST, () => {
    console.log(`🔒 HTTPS enabled on https://${HOST}:${HTTPS_PORT}`);
  });
} else {
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
