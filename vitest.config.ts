import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __BRAIN_CACHE_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
