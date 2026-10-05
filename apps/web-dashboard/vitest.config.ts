import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'dist/**', 'dist-types/**', 'node_modules/**'],
  },
});
