const { defineConfig } = require('playwright/test');

const port = Number(process.env.CARLOS_E2E_PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('CARLOS_E2E_PORT must be 1024–65535');

module.exports = defineConfig({
  testDir: './test/e2e',
  timeout: 15000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
  },
});
