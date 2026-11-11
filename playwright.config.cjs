const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './checks',
  testMatch: '**/*.spec.cjs',
  fullyParallel: false,
  workers: 1,
  use: { headless: true },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
