module.exports = {
  apps: [
    {
      name: "easonfansclub",
      cwd: process.cwd(),
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        PORT: "3000"
      }
    }
  ]
};
