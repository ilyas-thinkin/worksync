module.exports = {
  // Track env files in Git and copy them into place during update/rollback.
  envSync: [
    {
      source: 'deploy/env/backend.env',
      target: 'backend/.env',
      required: true
    }
  ],

  update: {
    prePull: [],

    // Ensure runtime directories exist after the repo update.
    postPull: [
      'mkdir -p logs reports qrcodes backups backend/logs'
    ],

    postDependencies: [],

    postMigrations: [],

    // Finalize PM2/runtime state after reload.
    postReload: [
      'bash deploy/apply-runtime-update.sh'
    ]
  },

  rollback: {
    postCodeRestore: [
      'mkdir -p logs reports qrcodes backups backend/logs'
    ],

    postDependencies: [],

    postDatabaseRestore: [],

    postStart: [
      'bash deploy/apply-runtime-update.sh'
    ]
  }
};
