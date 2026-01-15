require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { execFile } = require('child_process');
const https = require('https');
const fs = require('fs');
const realtime = require('./realtime');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Serve static files (Admin Panel)
app.use(express.static(path.join(__dirname, 'public')));
// Serve QR code images
app.use('/qrcodes', express.static(process.env.QRCODES_DIR || path.join(__dirname, '..', '..', 'qrcodes')));

// Realtime updates (SSE)
app.get('/events', realtime.handleEvents);
realtime.startDbListener();

// API Routes
const apiRoutes = require('./routes/api.routes');
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'WorkSync server is running',
    time: new Date()
  });
});

// IE page
app.get('/ie', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ie.html'));
});

// Line supervisor page
app.get('/supervisor', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'supervisor.html'));
});

// Serve admin panel for all other routes (Express 5 syntax)
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
