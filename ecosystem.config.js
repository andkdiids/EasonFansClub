module.exports = {
  apps: [
    {
      name: "easonfansclub",
      cwd: "/home/apps/easonfansclub/current",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        // V4.2 顺大师道具功能开关。持久化到 PM2 启动配置，确保 pm2 reload、
        // resurrect 及服务器重启后仍为 true；仅靠 .env 或临时注入会在标准
        // reload(--update-env) 时丢失，正是 2026-11-28 生产故障的成因之一。
        SHUN_ITEMS_ENABLED: "true"
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
      // The worker can be in a provider call for up to five minutes. Allow it
      // to finish the leased run after SIGTERM before PM2 force-kills it.
      kill_timeout: 6 * 60 * 1000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
