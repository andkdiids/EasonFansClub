module.exports = {
  apps: [
    {
      name: "easonfansclub",
      cwd: "/home/apps/easonfansclub/current",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        PORT: "3000"
      }
    },
    {
      name: "instagram-sync-worker",
      cwd: "/home/apps/easonfansclub/current",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "scripts/instagram-sync-worker.ts",
      autorestart: true,
      max_restarts: 5,
      min_uptime: "30s",
      restart_delay: 60000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
