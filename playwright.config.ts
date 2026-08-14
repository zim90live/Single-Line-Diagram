import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:41735',
    headless: true,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
    launchOptions: {
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
  },
  webServer: {
    command: 'npm run dev -- --port 41735 --strictPort',
    url: 'http://127.0.0.1:41735',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
