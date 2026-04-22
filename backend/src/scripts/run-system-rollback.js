#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  ROOT_DIR,
  readLock,
  readStatus,
  releaseLock,
  writeStatus,
  appendLog,
  clearLog
} = require('../utils/system-update');
const {
  loadSystemUpdatePlan,
  syncEnvironmentFiles,
  runHookCommands
} = require('../utils/system-update-plan');

const jobId = process.argv[2] || process.env.WORKSYNC_UPDATE_JOB_ID;
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const IGNORE_DIRS = ['backups/', 'logs/', 'reports/', 'qrcodes/', 'backend/logs/'];

if (!jobId) {
  console.error('Missing job ID');
  process.exit(1);
}

function nowIso() {
  return new Date().toISOString();
}

function updateStatus(patch) {
  const current = readStatus() || {};
  writeStatus({
    ...current,
    ...patch
  });
}

function isIgnoredRuntimePath(rawPath) {
  const normalized = rawPath.replace(/\\/g, '/');
  return IGNORE_DIRS.some((prefix) => normalized.startsWith(prefix));
}

function parseGitStatusLine(line) {
  if (!line || line.length < 4) return null;
  const raw = line.slice(3).trim();
  if (!raw) return null;
  return raw.includes(' -> ') ? raw.split(' -> ').pop().trim() : raw;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    appendLog(`$ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT_DIR,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...options.env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      text.split(/\r?\n/).filter(Boolean).forEach((line) => appendLog(line));
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      text.split(/\r?\n/).filter(Boolean).forEach((line) => appendLog(line));
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`));
      }
    });
  });
}

async function getRepoInfo() {
  const branch = (await runCommand('git', ['branch', '--show-current'])).stdout.trim() || 'main';
  const commit = (await runCommand('git', ['rev-parse', 'HEAD'])).stdout.trim();
  return {
    branch,
    commit,
    commitShort: commit.slice(0, 7)
  };
}

async function ensureCleanWorktree() {
  const result = await runCommand('git', ['status', '--porcelain', '--untracked-files=all']);
  const relevantChanges = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseGitStatusLine)
    .filter(Boolean)
    .filter((filePath) => !isIgnoredRuntimePath(filePath));

  if (relevantChanges.length > 0) {
    throw new Error(`Working tree has pending changes: ${relevantChanges.slice(0, 20).join(', ')}`);
  }
}

function formatStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '_' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function getLatestDbBackupPath() {
  const dailyDir = path.join(ROOT_DIR, 'backups', 'daily');
  if (!fs.existsSync(dailyDir)) return null;
  const candidates = fs.readdirSync(dailyDir)
    .filter((file) => file.endsWith('.sql.gz'))
    .sort();
  if (!candidates.length) return null;
  return path.join(dailyDir, candidates[candidates.length - 1]);
}

async function createSafetySnapshot(currentCommit) {
  const stamp = formatStamp();
  const backupTag = `backup-pre-rollback-${stamp}`;
  const bundleDir = path.join(ROOT_DIR, 'backups', 'code');
  const bundlePath = path.join(bundleDir, `worksync_pre_rollback_${stamp}.bundle`);

  fs.mkdirSync(bundleDir, { recursive: true });

  updateStatus({
    step: 'Creating safety snapshot',
    message: 'Creating rollback backup of the current system before restoring older state.'
  });

  await runCommand('git', ['tag', '-a', backupTag, '-m', `Safety snapshot before rollback from ${currentCommit}`]);
  await runCommand('git', ['bundle', 'create', bundlePath, 'HEAD', `refs/tags/${backupTag}`]);
  await runCommand('bash', [path.join(ROOT_DIR, 'scripts', 'db-backup.sh')]);

  const dbBackup = getLatestDbBackupPath();
  updateStatus({
    safetySnapshotTag: backupTag,
    safetySnapshotBundle: bundlePath,
    safetySnapshotDbBackup: dbBackup
  });
}

async function restoreDatabaseFromBackup(backupPath) {
  const dbHost = process.env.DB_HOST || '127.0.0.1';
  const dbPort = String(process.env.DB_PORT || '5432');
  const dbName = process.env.DB_NAME || 'worksync_db';
  const dbUser = process.env.DB_USER || 'worksync_user';
  const dbPassword = process.env.DB_PASSWORD || '';

  updateStatus({
    step: 'Restoring database',
    message: `Restoring database from ${backupPath}.`
  });

  await runCommand('psql', [
    '-h', dbHost,
    '-p', dbPort,
    '-U', dbUser,
    '-d', dbName,
    '-v', 'ON_ERROR_STOP=1',
    '-c',
    'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION CURRENT_USER;'
  ], {
    env: { PGPASSWORD: dbPassword }
  });

  await new Promise((resolve, reject) => {
    appendLog(`$ gunzip -c ${backupPath} | psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName}`);

    const gunzip = spawn('gunzip', ['-c', backupPath], {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const psql = spawn('psql', [
      '-h', dbHost,
      '-p', dbPort,
      '-U', dbUser,
      '-d', dbName,
      '-v', 'ON_ERROR_STOP=1'
    ], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        PGPASSWORD: dbPassword
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderr = '';

    gunzip.stdout.pipe(psql.stdin);

    gunzip.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      text.split(/\r?\n/).filter(Boolean).forEach((line) => appendLog(line));
    });

    psql.stdout.on('data', (chunk) => {
      chunk.toString().split(/\r?\n/).filter(Boolean).forEach((line) => appendLog(line));
    });

    psql.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      text.split(/\r?\n/).filter(Boolean).forEach((line) => appendLog(line));
    });

    let gunzipDone = false;
    let psqlDone = false;
    let gunzipCode = 0;
    let psqlCode = 0;

    function finalize() {
      if (!gunzipDone || !psqlDone) return;
      if (gunzipCode === 0 && psqlCode === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || 'Database restore failed'));
      }
    }

    gunzip.on('error', reject);
    psql.on('error', reject);
    gunzip.on('close', (code) => {
      gunzipDone = true;
      gunzipCode = code;
      finalize();
    });
    psql.on('close', (code) => {
      psqlDone = true;
      psqlCode = code;
      finalize();
    });
  });
}

async function run() {
  const lock = readLock();
  const status = readStatus() || {};

  if (!lock || lock.jobId !== jobId) {
    throw new Error('Rollback lock is missing or belongs to another job');
  }

  const targetTag = status.rollbackTargetTag || status.backupTag;
  const targetCommit = status.rollbackTargetCommit;
  const targetDbBackup = status.rollbackTargetDbBackup || status.dbBackup;

  if (!targetTag || !targetCommit || !targetDbBackup) {
    throw new Error('Rollback target is incomplete');
  }

  clearLog();
  appendLog(`Starting rollback job ${jobId}`);

  const currentRepo = await getRepoInfo();
  updateStatus({
    action: 'rollback',
    jobId,
    status: 'running',
    step: 'Checking repository',
    message: 'Checking repository state before rollback.',
    startedAt: lock.startedAt || nowIso(),
    finishedAt: null,
    beforeCommit: currentRepo.commit,
    afterCommit: null
  });

  await ensureCleanWorktree();
  await createSafetySnapshot(currentRepo.commit);

  updateStatus({
    step: 'Stopping application',
    message: 'Stopping PM2 process before restoring code and database.'
  });
  await runCommand('pm2', ['stop', 'worksync'], { cwd: BACKEND_DIR });

  updateStatus({
    step: 'Restoring code',
    message: `Resetting repository to ${targetTag}.`
  });
  await runCommand('git', ['reset', '--hard', targetCommit]);
  await runCommand('git', ['clean', '-fd', '-e', 'backups/', '-e', 'logs/', '-e', 'reports/', '-e', 'qrcodes/', '-e', 'backend/logs/']);

  const restoredPlan = loadSystemUpdatePlan();
  await syncEnvironmentFiles(restoredPlan, { updateStatus, appendLog });
  await runHookCommands('Running post-code-restore hooks', restoredPlan.rollback.postCodeRestore, {
    runCommand,
    updateStatus,
    appendLog
  });

  updateStatus({
    step: 'Installing backend dependencies',
    message: 'Running npm ci in backend for restored code.'
  });
  await runCommand('npm', ['ci', '--omit=dev'], { cwd: BACKEND_DIR });
  await runHookCommands('Running rollback post-dependency hooks', restoredPlan.rollback.postDependencies, {
    runCommand,
    updateStatus,
    appendLog
  });

  await restoreDatabaseFromBackup(targetDbBackup);
  await runHookCommands('Running rollback post-database hooks', restoredPlan.rollback.postDatabaseRestore, {
    runCommand,
    updateStatus,
    appendLog
  });

  updateStatus({
    step: 'Starting application',
    message: 'Starting PM2 process with restored code.'
  });
  await runCommand('pm2', ['start', path.join(BACKEND_DIR, 'ecosystem.config.js'), '--only', 'worksync', '--update-env'], {
    cwd: BACKEND_DIR
  });
  await runHookCommands('Running rollback post-start hooks', restoredPlan.rollback.postStart, {
    runCommand,
    updateStatus,
    appendLog
  });

  const finalRepo = await getRepoInfo();
  updateStatus({
    status: 'success',
    step: 'Completed',
    message: `System rolled back to ${targetTag}.`,
    finishedAt: nowIso(),
    afterCommit: finalRepo.commit
  });
  appendLog(`Rollback finished successfully at ${finalRepo.commit}`);
}

run()
  .catch((err) => {
    appendLog(`Rollback failed: ${err.message}`);
    updateStatus({
      status: 'failed',
      step: 'Failed',
      message: err.message,
      finishedAt: nowIso()
    });
    process.exitCode = 1;
  })
  .finally(() => {
    releaseLock();
  });
