const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const {
  ROOT_DIR,
  readStatus,
  writeStatus,
  getLogTail,
  acquireLock,
  readLock,
  releaseLock
} = require('../utils/system-update');

const router = express.Router();

function getRepoValue(args, fallback = '') {
  try {
    return execFileSync('git', args, {
      cwd: ROOT_DIR,
      encoding: 'utf8'
    }).trim();
  } catch (err) {
    return fallback;
  }
}

function getRepoInfo() {
  const commit = getRepoValue(['rev-parse', 'HEAD']);
  return {
    branch: getRepoValue(['branch', '--show-current'], 'main'),
    commit,
    commitShort: commit ? commit.slice(0, 7) : ''
  };
}

function getLatestBackupTag() {
  const tags = getRepoValue(['tag', '--list', 'backup-*', '--sort=-creatordate']);
  return tags.split(/\r?\n/).filter(Boolean)[0] || null;
}

function getLatestDbBackupPath() {
  const dailyDir = path.join(ROOT_DIR, 'backups', 'daily');
  if (!fs.existsSync(dailyDir)) return null;
  const backups = fs.readdirSync(dailyDir)
    .filter((file) => file.endsWith('.sql.gz'))
    .sort();
  if (!backups.length) return null;
  return path.join(dailyDir, backups[backups.length - 1]);
}

function resolveRollbackTarget(status) {
  if (
    status?.action === 'rollback' &&
    ['starting', 'running'].includes(status.status) &&
    status.rollbackTargetTag &&
    status.rollbackTargetDbBackup &&
    status.rollbackTargetCommit
  ) {
    return {
      backupTag: status.rollbackTargetTag,
      dbBackup: status.rollbackTargetDbBackup,
      targetCommit: status.rollbackTargetCommit
    };
  }

  if (
    status?.action === 'update' &&
    status.backupTag &&
    status.dbBackup &&
    status.beforeCommit &&
    fs.existsSync(status.dbBackup)
  ) {
    return {
      backupTag: status.backupTag,
      dbBackup: status.dbBackup,
      targetCommit: status.beforeCommit
    };
  }

  const backupTag = getLatestBackupTag();
  const dbBackup = getLatestDbBackupPath();
  const targetCommit = backupTag ? getRepoValue(['rev-list', '-n', '1', backupTag]) : '';

  if (!backupTag || !dbBackup || !targetCommit) {
    return null;
  }

  return {
    backupTag,
    dbBackup,
    targetCommit
  };
}

function spawnJob(scriptName, jobId) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', scriptName), jobId], {
    cwd: ROOT_DIR,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WORKSYNC_UPDATE_JOB_ID: jobId
    }
  });
  child.unref();
}

router.get('/status', (req, res) => {
  const status = readStatus() || { status: 'idle', step: 'Waiting' };
  const rollbackTarget = resolveRollbackTarget(status);
  res.json({
    success: true,
    data: {
      repo: getRepoInfo(),
      status,
      lock: readLock(),
      logTail: getLogTail(150),
      rollbackTarget,
      canRollback: Boolean(rollbackTarget?.backupTag && rollbackTarget?.dbBackup && rollbackTarget?.targetCommit)
    }
  });
});

router.post('/start', (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin only' });
  }

  const existingLock = readLock();
  if (existingLock) {
    return res.status(409).json({
      success: false,
      error: 'An update is already running',
      data: {
        status: readStatus(),
        lock: existingLock
      }
    });
  }

  const jobId = `update-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const lockData = {
    jobId,
    startedAt: new Date().toISOString(),
    startedBy: req.user?.role || 'admin'
  };

  if (!acquireLock(lockData)) {
    return res.status(409).json({ success: false, error: 'An update is already running' });
  }

  writeStatus({
    action: 'update',
    jobId,
    status: 'starting',
    step: 'Queued',
    message: 'System update has been queued.',
    startedAt: lockData.startedAt,
    finishedAt: null,
    beforeCommit: getRepoInfo().commit,
    afterCommit: null,
    backupTag: null,
    bundlePath: null,
    dbBackup: null
  });

  try {
    spawnJob('run-system-update.js', jobId);
  } catch (err) {
    releaseLock();
    return res.status(500).json({ success: false, error: `Failed to start update: ${err.message}` });
  }

  res.json({
    success: true,
    message: 'System update started',
    data: {
      jobId
    }
  });
});

router.post('/rollback', (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin only' });
  }

  const existingLock = readLock();
  if (existingLock) {
    return res.status(409).json({
      success: false,
      error: 'Another system job is already running',
      data: {
        status: readStatus(),
        lock: existingLock
      }
    });
  }

  const currentStatus = readStatus();
  const rollbackTarget = resolveRollbackTarget(currentStatus);
  if (!rollbackTarget) {
    return res.status(400).json({
      success: false,
      error: 'No rollback point is available yet'
    });
  }

  const currentRepo = getRepoInfo();
  const jobId = `rollback-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const lockData = {
    jobId,
    startedAt: new Date().toISOString(),
    startedBy: req.user?.role || 'admin'
  };

  if (!acquireLock(lockData)) {
    return res.status(409).json({ success: false, error: 'Another system job is already running' });
  }

  writeStatus({
    action: 'rollback',
    jobId,
    status: 'starting',
    step: 'Queued',
    message: 'System rollback has been queued.',
    startedAt: lockData.startedAt,
    finishedAt: null,
    beforeCommit: currentRepo.commit,
    afterCommit: null,
    backupTag: rollbackTarget.backupTag,
    bundlePath: null,
    dbBackup: rollbackTarget.dbBackup,
    rollbackTargetTag: rollbackTarget.backupTag,
    rollbackTargetDbBackup: rollbackTarget.dbBackup,
    rollbackTargetCommit: rollbackTarget.targetCommit,
    safetySnapshotTag: null,
    safetySnapshotBundle: null,
    safetySnapshotDbBackup: null
  });

  try {
    spawnJob('run-system-rollback.js', jobId);
  } catch (err) {
    releaseLock();
    return res.status(500).json({ success: false, error: `Failed to start rollback: ${err.message}` });
  }

  res.json({
    success: true,
    message: 'System rollback started',
    data: {
      jobId,
      rollbackTarget
    }
  });
});

module.exports = router;
