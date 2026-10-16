const { defineConfig } = require("@playwright/test");
const port = Number(process.env.PORT || 4173);

module.exports = defineConfig({
  testDir: "./tests",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    headless: true
  },
  webServer: {
    command: "node tests/server.js",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false
  }
});
