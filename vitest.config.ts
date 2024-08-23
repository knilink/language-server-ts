import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Specify glob patterns for matching test files
    include: ['**/*.test.ts'],
    // You can configure other options here as well
  },
});
