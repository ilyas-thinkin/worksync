#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const {
  ROOT_DIR,
  readLock,
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
  const current = require('../utils/system-update').readStatus() || {};
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

async function createRollbackPoint(beforeCommit) {
  const stamp = formatStamp();
  const backupTag = `backup-auto-update-${stamp}`;
  const bundleDir = path.join(ROOT_DIR, 'backups', 'code');
  const bundlePath = path.join(bundleDir, `worksync_auto_update_${stamp}.bundle`);

  fs.mkdirSync(bundleDir, { recursive: true });

  updateStatus({
    step: 'Creating rollback point',
    message: 'Creating Git rollback point and backup bundle.'
  });

  await runCommand('git', ['tag', '-a', backupTag, '-m', `Auto rollback point before system update from ${beforeCommit}`]);
  await runCommand('git', ['bundle', 'create', bundlePath, 'HEAD', `refs/tags/${backupTag}`]);

  updateStatus({
    backupTag,
    bundlePath
  });

  return { backupTag, bundlePath };
}

async function run() {
  const lock = readLock();
  if (!lock || lock.jobId !== jobId) {
    throw new Error('Update lock is missing or belongs to another job');
  }

  clearLog();
  appendLog(`Starting system update job ${jobId}`);

  const initialRepo = await getRepoInfo();
  updateStatus({
    action: 'update',
    jobId,
    status: 'running',
    step: 'Checking repository',
    message: 'Checking repository state.',
    startedAt: lock.startedAt || nowIso(),
    finishedAt: null,
    beforeCommit: initialRepo.commit,
    afterCommit: initialRepo.commit,
    branch: initialRepo.branch
  });

  await ensureCleanWorktree();
  const initialPlan = loadSystemUpdatePlan();

  await runHookCommands('Running pre-pull hooks', initialPlan.update.prePull, {
    runCommand,
    updateStatus,
    appendLog
  });

  updateStatus({
    step: 'Fetching latest code',
    message: `Fetching latest changes from origin/${initialRepo.branch}.`
  });
  await runCommand('git', ['fetch', 'origin', initialRepo.branch]);

  const remoteCommit = (await runCommand('git', ['rev-parse', `origin/${initialRepo.branch}`])).stdout.trim();
  if (remoteCommit === initialRepo.commit) {
    updateStatus({
      status: 'success',
      step: 'No update needed',
      message: 'Already on the latest commit.',
      finishedAt: nowIso(),
      afterCommit: initialRepo.commit
    });
    appendLog('Repository already up to date.');
    return;
  }

  await createRollbackPoint(initialRepo.commit);

  updateStatus({
    step: 'Backing up database',
    message: 'Creating database backup before pulling changes.'
  });
  await runCommand('bash', [path.join(ROOT_DIR, 'scripts', 'db-backup.sh')]);
  updateStatus({
    dbBackup: getLatestDbBackupPath()
  });

  updateStatus({
    step: 'Pulling latest code',
    message: `Fast-forwarding to origin/${initialRepo.branch}.`
  });
  await runCommand('git', ['merge', '--ff-only', `origin/${initialRepo.branch}`]);

  const updatedPlan = loadSystemUpdatePlan();
  await syncEnvironmentFiles(updatedPlan, { updateStatus, appendLog });
  await runHookCommands('Running post-pull hooks', updatedPlan.update.postPull, {
    runCommand,
    updateStatus,
    appendLog
  });

  updateStatus({
    step: 'Installing backend dependencies',
    message: 'Running npm ci in backend.'
  });
  await runCommand('npm', ['ci', '--omit=dev'], { cwd: BACKEND_DIR });
  await runHookCommands('Running post-dependency hooks', updatedPlan.update.postDependencies, {
    runCommand,
    updateStatus,
    appendLog
  });

  updateStatus({
    step: 'Running database migrations',
    message: 'Applying pending SQL migrations.'
  });
  await runCommand(process.execPath, [path.join(BACKEND_DIR, 'src', 'scripts', 'run-migrations.js')], {
    cwd: BACKEND_DIR
  });
  await runHookCommands('Running post-migration hooks', updatedPlan.update.postMigrations, {
    runCommand,
    updateStatus,
    appendLog
  });

  updateStatus({
    step: 'Reloading application',
    message: 'Reloading PM2 process.'
  });
  await runCommand('pm2', ['reload', path.join(BACKEND_DIR, 'ecosystem.config.js'), '--only', 'worksync', '--update-env'], {
    cwd: BACKEND_DIR
  });
  await runHookCommands('Running post-reload hooks', updatedPlan.update.postReload, {
    runCommand,
    updateStatus,
    appendLog
  });

  const finalRepo = await getRepoInfo();
  updateStatus({
    status: 'success',
    step: 'Completed',
    message: `System updated to ${finalRepo.commitShort}.`,
    finishedAt: nowIso(),
    afterCommit: finalRepo.commit
  });
  appendLog(`System update finished successfully at ${finalRepo.commit}`);
}

run()
  .catch((err) => {
    appendLog(`System update failed: ${err.message}`);
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
