module.exports = {
  apps: [{
    name: 'arc-backend',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    // Đợi 10 giây trước khi restart nếu crash
    min_uptime: '10s',
    max_restarts: 10,
    // Restart nếu sử dụng quá 1GB memory
    max_memory_restart: '1G'
  }]
};

