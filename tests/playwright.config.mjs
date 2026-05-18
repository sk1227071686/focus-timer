import { defineConfig } from '@playwright/test';
export default defineConfig({
  use: { headless: true, viewport: { width: 1200, height: 900 } },
  testsDir: './tests'
});