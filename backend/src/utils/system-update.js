const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');
const STATUS_FILE = path.join(LOGS_DIR, 'system-update-status.json');
const LOG_FILE = path.join(LOGS_DIR, 'system-update.log');
const LOCK_FILE = path.join(LOGS_DIR, 'system-update.lock');

function ensureRuntimeDirs() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return null;
  }
}

function writeStatus(status) {
  ensureRuntimeDirs();
  fs.writeFileSync(STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function readStatus() {
  ensureRuntimeDirs();
  return readJson(STATUS_FILE);
}

function appendLog(message) {
  ensureRuntimeDirs();
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf8');
}

function clearLog() {
  ensureRuntimeDirs();
  fs.writeFileSync(LOG_FILE, '', 'utf8');
}

function getLogTail(maxLines = 120) {
  ensureRuntimeDirs();
  if (!fs.existsSync(LOG_FILE)) return [];
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-maxLines);
}

function acquireLock(lockData) {
  ensureRuntimeDirs();
  try {
    fs.writeFileSync(LOCK_FILE, `${JSON.stringify(lockData, null, 2)}\n`, { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

function readLock() {
  ensureRuntimeDirs();
  return readJson(LOCK_FILE);
}

function releaseLock() {
  ensureRuntimeDirs();
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }
}

module.exports = {
  ROOT_DIR,
  LOGS_DIR,
  STATUS_FILE,
  LOG_FILE,
  LOCK_FILE,
  ensureRuntimeDirs,
  writeStatus,
  readStatus,
  appendLog,
  clearLog,
  getLogTail,
  acquireLock,
  readLock,
  releaseLock
};
