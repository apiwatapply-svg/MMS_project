module.exports = {
  apps: [
    {
      name: "mms-dashboard-api",
      script: "server.js",
      cwd: "./backend",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 5005,
      },
      max_memory_restart: "700M",
      out_file: "./logs/pm2-out.log",
      error_file: "./logs/pm2-error.log",
      time: true,
    },
  ],
};
