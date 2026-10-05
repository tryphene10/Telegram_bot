import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 45173 --strictPort',
    url: 'http://127.0.0.1:45173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: { baseURL: 'http://127.0.0.1:45173', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1536, height: 1024 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 } } },
  ],
});
