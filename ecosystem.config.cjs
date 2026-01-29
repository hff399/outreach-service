module.exports = {
  apps: [
    {
      name: 'outreach',
      cwd: './apps/backend',
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        BACKEND_PORT: 3001,
        BACKEND_HOST: '0.0.0.0',
      },
      env_production: {
        NODE_ENV: 'production',
        BACKEND_PORT: 3001,
        BACKEND_HOST: '0.0.0.0',
      },
      max_memory_restart: '500M',
      error_file: '../../logs/error.log',
      out_file: '../../logs/out.log',
      merge_logs: true,
      time: true,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 30000,
    },
  ],
};
