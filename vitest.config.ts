import { defineConfig } from 'vitest/config';

export default defineConfig({
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
