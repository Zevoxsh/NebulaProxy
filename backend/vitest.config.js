import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['routes/**/*.js', 'services/**/*.js', 'middleware/**/*.js'],
      exclude: ['node_modules/**', 'tests/**', '**/*.test.js']
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
