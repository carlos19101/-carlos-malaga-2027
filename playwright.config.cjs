const { defineConfig } = require('playwright/test');

module.exports = defineConfig({
  testDir: './test/e2e',
  timeout: 15000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173`,
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
