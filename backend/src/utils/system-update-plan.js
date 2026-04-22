const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./system-update');

const DEFAULT_PLAN = {
  envSync: [],
  update: {
    prePull: [],
    postPull: [],
    postDependencies: [],
    postMigrations: [],
    postReload: []
  },
  rollback: {
    postCodeRestore: [],
    postDependencies: [],
    postDatabaseRestore: [],
    postStart: []
  }
};

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function mergeSection(base, incoming) {
  return Object.keys(base).reduce((acc, key) => {
    acc[key] = asArray(incoming?.[key]);
    return acc;
  }, {});
}

function cloneDefaultPlan() {
  return {
    envSync: [],
    update: mergeSection(DEFAULT_PLAN.update, {}),
    rollback: mergeSection(DEFAULT_PLAN.rollback, {})
  };
}

function resolvePlanPaths() {
  return [
    path.join(ROOT_DIR, 'deploy', 'system-update.config.js'),
    path.join(ROOT_DIR, 'deploy', 'system-update.config.json')
  ];
}

function loadRawPlan() {
  const planPaths = resolvePlanPaths();
  for (const planPath of planPaths) {
    if (!fs.existsSync(planPath)) continue;
    if (planPath.endsWith('.js')) {
      delete require.cache[require.resolve(planPath)];
      const loaded = require(planPath);
      return typeof loaded === 'function' ? loaded() : loaded;
    }
    return JSON.parse(fs.readFileSync(planPath, 'utf8'));
  }
  return null;
}

function loadSystemUpdatePlan() {
  const rawPlan = loadRawPlan();
  if (!rawPlan || typeof rawPlan !== 'object') {
    return cloneDefaultPlan();
  }

  return {
    envSync: asArray(rawPlan.envSync),
    update: mergeSection(DEFAULT_PLAN.update, rawPlan.update || {}),
    rollback: mergeSection(DEFAULT_PLAN.rollback, rawPlan.rollback || {})
  };
}

function resolvePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return null;
  return path.isAbsolute(rawPath) ? rawPath : path.join(ROOT_DIR, rawPath);
}

async function syncEnvironmentFiles(plan, { updateStatus, appendLog }) {
  const entries = asArray(plan?.envSync);
  if (!entries.length) return [];

  updateStatus({
    step: 'Syncing environment files',
    message: 'Applying tracked environment files from the repository.'
  });

  const syncedTargets = [];

  for (const entry of entries) {
    const source = resolvePath(entry.source);
    const target = resolvePath(entry.target);
    const required = entry.required !== false;

    if (!source || !target) {
      throw new Error('Invalid envSync entry: source and target are required');
    }

    if (!fs.existsSync(source)) {
      if (required) {
        throw new Error(`Tracked env source not found: ${path.relative(ROOT_DIR, source)}`);
      }
      appendLog(`Skipping optional env sync source ${path.relative(ROOT_DIR, source)} (not found).`);
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    appendLog(`Synced environment file ${path.relative(ROOT_DIR, source)} -> ${target}`);
    syncedTargets.push(target);
  }

  return syncedTargets;
}

function normalizeCommandEntry(entry) {
  if (typeof entry === 'string') {
    return {
      command: 'bash',
      args: ['-lc', entry],
      cwd: ROOT_DIR,
      label: entry
    };
  }

  if (!entry || typeof entry !== 'object' || !entry.command) {
    throw new Error('Invalid command hook entry');
  }

  return {
    command: entry.command,
    args: Array.isArray(entry.args) ? entry.args.map((arg) => String(arg)) : [],
    cwd: resolvePath(entry.cwd) || ROOT_DIR,
    env: entry.env && typeof entry.env === 'object' ? entry.env : {},
    label: entry.label || [entry.command].concat(Array.isArray(entry.args) ? entry.args : []).join(' ')
  };
}

async function runHookCommands(stageLabel, commands, { runCommand, updateStatus, appendLog }) {
  const entries = asArray(commands);
  if (!entries.length) return;

  updateStatus({
    step: stageLabel,
    message: `Running configured ${stageLabel.toLowerCase()} commands.`
  });

  for (const entry of entries) {
    const normalized = normalizeCommandEntry(entry);
    appendLog(`Running hook: ${normalized.label}`);
    await runCommand(normalized.command, normalized.args, {
      cwd: normalized.cwd,
      env: normalized.env
    });
  }
}

module.exports = {
  loadSystemUpdatePlan,
  syncEnvironmentFiles,
  runHookCommands
};
