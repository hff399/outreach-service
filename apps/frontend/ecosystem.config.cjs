module.exports = {
  apps: [
    {
      name: 'outreach-frontend',
      script: 'npx',
      args: 'next start',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'none',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
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
