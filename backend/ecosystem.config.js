/**
 * PM2 Ecosystem Configuration for WorkSync
 *
 * Features:
 * - Cluster mode with 4 instances (one per CPU core)
 * - Auto-restart on crash
 * - Memory limit monitoring
 * - Log rotation
 * - Graceful shutdown handling
 */

module.exports = {
  apps: [
    {
      name: 'worksync',
      script: 'src/server.js',
      cwd: '/home/worksync/worksync/backend',

      // Cluster Mode - Use all 4 CPU cores
      instances: 4,
      exec_mode: 'cluster',

      // Auto-restart settings
      autorestart: true,
      watch: false,  // Disable in production (enable for dev)
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,  // Wait 4 seconds before restart

      // Memory management
      max_memory_restart: '400M',  // Restart if memory exceeds 400MB per instance

      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0'
      },

      // Logging
      log_file: '/home/worksync/worksync/logs/combined.log',
      out_file: '/home/worksync/worksync/logs/out.log',
      error_file: '/home/worksync/worksync/logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Log rotation (handled by pm2-logrotate module)
      // Install: pm2 install pm2-logrotate
      // Configure: pm2 set pm2-logrotate:max_size 10M
      //            pm2 set pm2-logrotate:retain 7

      // Graceful shutdown
      kill_timeout: 5000,  // Wait 5 seconds for graceful shutdown
      listen_timeout: 10000,  // Wait 10 seconds for app to listen

      // Exponential backoff restart delay
      exp_backoff_restart_delay: 100,

      // Source map support for better error traces
      source_map_support: true,

      // Node.js arguments
      node_args: [
        '--max-old-space-size=512'  // Limit heap to 512MB
      ],

      // Health check (optional - requires endpoint)
      // Uncomment if you add a /health endpoint
      // health_check: {
      //   url: 'http://localhost:3000/health',
      //   interval: 30000,
      //   timeout: 5000
      // }
    }
  ],

  // Deployment configuration (optional - for remote deployment)
  deploy: {
    production: {
      user: 'worksync',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:username/worksync.git',
      path: '/home/worksync/worksync',
      'pre-deploy': 'git fetch --all',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      env: {
        NODE_ENV: 'production'
      }
    }
  }
};
