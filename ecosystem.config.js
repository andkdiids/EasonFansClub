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
    }
  ]
};
