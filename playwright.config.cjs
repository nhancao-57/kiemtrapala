const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './checks',
  testMatch: '**/*.spec.cjs',
  fullyParallel: false,
  workers: 1,
  use: { browserName: 'chromium', channel: 'chrome', headless: true },
});
