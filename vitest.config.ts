import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __BRAIN_CACHE_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      'tests/services/chunker.test.ts', // tree-sitter native binding not available in this arch
    ],
  },
});
