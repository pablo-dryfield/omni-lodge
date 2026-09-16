'use strict';

const common = Object.freeze({
  cwd: '/',
  interpreter: '/usr/bin/node',
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  watch: false,
  max_restarts: 10,
  min_uptime: '10s',
  kill_timeout: 15_000,
  listen_timeout: 15_000,
  merge_logs: true,
  time: true,
  env: Object.freeze({ NODE_ENV: 'production' }),
});

module.exports = {
  apps: [
    {
      ...common,
      name: 'omni-lodge-be',
      script: '/usr/local/libexec/omnilodge/runtime-launcher.mjs',
      args: ['backend'],
      out_file: '/var/lib/omnilodge/logs/pm2/backend-out.log',
      error_file: '/var/lib/omnilodge/logs/pm2/backend-error.log',
    },
    {
      ...common,
      name: 'omni-lodge-ui-server',
      script: '/usr/local/libexec/omnilodge/runtime-launcher.mjs',
      args: ['ui-server'],
      out_file: '/var/lib/omnilodge/logs/pm2/ui-server-out.log',
      error_file: '/var/lib/omnilodge/logs/pm2/ui-server-error.log',
    },
  ],
};
