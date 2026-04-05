// wasm-probe.mjs — Proves WASM path resolution works from dist/wasm/
// Run: npm run build && node src/scripts/wasm-probe.mjs
//
// This validates DIST-02: locateFile resolves tree-sitter.wasm using
// a module-scope __dir captured from import.meta.url.

import { Parser, Language } from 'web-tree-sitter';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Module-scope capture — the correct pattern for tsup bundles
const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const wasmDir = join(__dir, '../../dist/wasm');

await Parser.init({
  locateFile(scriptName, _scriptDirectory) {
    return join(wasmDir, scriptName);
  }
});

// Load one grammar to prove Language.load works with absolute paths
const TypeScript = await Language.load(join(wasmDir, 'tree-sitter-typescript.wasm'));
const parser = new Parser();
parser.setLanguage(TypeScript);

// Parse a trivial snippet to prove the full pipeline works
const tree = parser.parse('const x: number = 1;');
const rootType = tree.rootNode.type;
tree.delete(); // WASM heap cleanup — required pattern

if (rootType !== 'program') {
  console.error(`WASM probe: FAILED — expected root node type "program", got "${rootType}"`);
  process.exit(1);
}

console.log('root node type:', rootType);
console.log('WASM probe: PASSED');
