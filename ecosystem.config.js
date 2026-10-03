module.exports = {
  apps: [{
    name: 'azerclaw',
    script: 'safe-start.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 0,
    min_uptime: '10s'
  }]
};