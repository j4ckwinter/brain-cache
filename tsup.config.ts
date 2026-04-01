import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: true,
    dts: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    entry: { mcp: 'src/mcp/index.ts' },
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: false,
    dts: true,
  },
]);
