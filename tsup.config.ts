import { defineConfig } from "tsup";
import pkg from "./package.json" assert { type: "json" };

export default defineConfig([
  {
    entry: { cli: "src/cli/index.ts" },
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    clean: true,
    dts: {
      compilerOptions: {
        ignoreDeprecations: "6.0",
      },
    },
    banner: {
      js: "#!/usr/bin/env node",
    },
    define: {
      __BRAIN_CACHE_VERSION__: JSON.stringify(pkg.version),
    },
  },
  {
    entry: { mcp: "src/mcp/main.ts" },
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    clean: false,
    dts: {
      compilerOptions: {
        ignoreDeprecations: "6.0",
      },
    },
    define: {
      __BRAIN_CACHE_VERSION__: JSON.stringify(pkg.version),
    },
  },
]);
