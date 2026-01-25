const path = require('path');

module.exports = {
  apps: [
    {
      name: 'outreach-backend',
      script: path.resolve(__dirname, '../../node_modules/.bin/tsx'),
      args: 'src/index.ts',
      cwd: __dirname,
      instances: 1, // Single instance for Telegram client management
      exec_mode: 'fork',
      interpreter: 'none',
      env: {
        NODE_ENV: 'development',
        BACKEND_PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
        BACKEND_PORT: 3001,
      },
      max_memory_restart: '500M',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      merge_logs: true,
      time: true,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
