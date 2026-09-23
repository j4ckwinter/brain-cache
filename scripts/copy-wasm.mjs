#!/usr/bin/env node
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const destination = resolve(process.argv[2] ?? 'dist/wasm');
const files = [
  ['node_modules/web-tree-sitter/tree-sitter.wasm', 'tree-sitter.wasm'],
  ...['typescript', 'tsx', 'python', 'go', 'rust'].map((language) => [
    `node_modules/tree-sitter-wasms/out/tree-sitter-${language}.wasm`,
    `tree-sitter-${language}.wasm`,
  ]),
];

await mkdir(destination, { recursive: true });
await Promise.all(files.map(([source, name]) => copyFile(resolve(source), resolve(destination, name))));
