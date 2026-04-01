import { defineConfig } from "tsup";
import pkg from "./package.json" assert { type: "json" };

export default defineConfig([
  {
    entry: { cli: "src/cli/index.ts" },
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    clean: true,
    dts: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
    define: {
      __BRAIN_CACHE_VERSION__: JSON.stringify(pkg.version),
    },
  },
  {
    entry: { mcp: "src/mcp/index.ts" },
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    clean: false,
    dts: true,
    define: {
      __BRAIN_CACHE_VERSION__: JSON.stringify(pkg.version),
    },
  },
]);
