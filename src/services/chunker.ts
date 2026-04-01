import { createRequire } from 'node:module';
import { extname } from 'node:path';
import { childLogger } from './logger.js';
import type { CodeChunk } from '../lib/types.js';
import type TreeSitter from 'tree-sitter';
type SyntaxNode = TreeSitter.SyntaxNode;

// CJS require workaround for tree-sitter packages.
//
// tree-sitter and its language grammars (tree-sitter-typescript, tree-sitter-python,
// etc.) are CommonJS packages that use module.exports. They do not provide ESM entry
// points, so a standard `import` fails at runtime in this ESM project.
//
// createRequire() creates a CJS require() function anchored to this file's URL,
// which is the official Node.js interop pattern for loading CJS from ESM.
//
// This workaround can be removed when:
//   - tree-sitter ships an ESM entry point (tracked in tree-sitter >= 0.24.0), OR
//   - the project migrates to web-tree-sitter (WASM-based, ships as ESM natively)
//     — currently out of scope per REQUIREMENTS.md
const _require = createRequire(import.meta.url);
const Parser = _require('tree-sitter');
const { typescript: tsLang, tsx: tsxLang } = _require('tree-sitter-typescript');
const pythonLang = _require('tree-sitter-python');
const goLang = _require('tree-sitter-go');
const rustLang = _require('tree-sitter-rust');

const log = childLogger('chunker');

// Maps file extensions to tree-sitter language objects.
// TypeScript grammar is used for JS files — it is a superset and parses JS correctly.
export const LANGUAGE_MAP: Record<string, object> = {
  '.ts':  tsLang,
  '.tsx': tsxLang,
  '.mts': tsLang,
  '.cts': tsLang,
  '.js':  tsLang,
  '.jsx': tsxLang,
  '.mjs': tsLang,
  '.cjs': tsLang,
  '.py':  pythonLang,
  '.pyi': pythonLang,
  '.go':  goLang,
  '.rs':  rustLang,
};

// Maps language categories to extractable AST node types.
export const CHUNK_NODE_TYPES: Record<string, Set<string>> = {
  typescript: new Set([
    'function_declaration',
    'function_expression',
    'arrow_function',
    'generator_function_declaration',
    'class_declaration',
    'abstract_class_declaration',
    'method_definition',
  ]),
  python: new Set([
    'function_definition',
    'async_function_definition',
    'class_definition',
  ]),
  go: new Set([
    'function_declaration',
    'method_declaration',
    'func_literal',
  ]),
  rust: new Set([
    'function_item',
    'impl_item',
    'closure_expression',
  ]),
};

// Maps file extensions to language category keys used in CHUNK_NODE_TYPES.
function getLanguageCategory(ext: string): string {
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'typescript';
    case '.py':
    case '.pyi':
      return 'python';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    default:
      return '';
  }
}

// Reads the name field from a tree-sitter node, or returns null.
function extractName(node: SyntaxNode): string | null {
  return node.childForFieldName?.('name')?.text ?? null;
}

// Walks up the parent chain looking for a class/impl parent and returns its name.
function extractScope(node: SyntaxNode): string | null {
  let current = node.parent;
  while (current) {
    if (
      current.type === 'class_declaration' ||
      current.type === 'abstract_class_declaration' ||
      current.type === 'class_definition' ||
      current.type === 'impl_item'
    ) {
      return extractName(current);
    }
    current = current.parent;
  }
  return null;
}

// Maps tree-sitter node types to CodeChunk chunkType values.
function classifyChunkType(nodeType: string): 'function' | 'class' | 'method' {
  if (
    nodeType === 'class_declaration' ||
    nodeType === 'abstract_class_declaration' ||
    nodeType === 'class_definition' ||
    nodeType === 'impl_item'
  ) {
    return 'class';
  }
  if (nodeType === 'method_definition' || nodeType === 'method_declaration') {
    return 'method';
  }
  return 'function';
}

// Recursively walks all nodes in the AST.
function* walkNodes(node: SyntaxNode): Generator<SyntaxNode> {
  yield node;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child !== null) {
      yield* walkNodes(child);
    }
  }
}

/**
 * Parses source code at AST function/class/method boundaries and returns CodeChunk objects.
 *
 * Returns an empty array for unsupported file extensions.
 * Returns a single file-type fallback chunk if no AST nodes are extractable (e.g. type-only files).
 */
export function chunkFile(filePath: string, content: string): CodeChunk[] {
  const ext = extname(filePath);
  const lang = LANGUAGE_MAP[ext];

  if (!lang) {
    return [];
  }

  const category = getLanguageCategory(ext);
  const nodeTypes = CHUNK_NODE_TYPES[category];

  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(content);

  const chunks: CodeChunk[] = [];

  for (const node of walkNodes(tree.rootNode)) {
    if (!nodeTypes.has(node.type)) {
      continue;
    }

    // For arrow functions: only extract top-level or exported ones.
    // Top-level export pattern: root > export_statement > lexical_declaration > variable_declarator > arrow_function (depth=4)
    // Nested callback pattern: depth >= 6 (inside function body > call_expression > arguments > arrow_function)
    // Threshold: depth <= 5 admits top-level/exported arrow functions; depth > 5 skips nested callbacks.
    if (node.type === 'arrow_function') {
      let depth = 0;
      let cur = node.parent;
      while (cur) {
        depth++;
        cur = cur.parent;
      }
      if (depth > 5) {
        continue;
      }
    }

    const chunkType = classifyChunkType(node.type);
    const name = extractName(node);
    const scope = extractScope(node);

    chunks.push({
      id:        `${filePath}:${node.startPosition.row}`,
      filePath,
      chunkType,
      scope,
      name,
      content:   content.slice(node.startIndex, node.endIndex),
      startLine: node.startPosition.row + 1,
      endLine:   node.endPosition.row + 1,
    });
  }

  // Fallback: if language was found but no chunks extracted, emit one file-type chunk
  if (chunks.length === 0) {
    chunks.push({
      id:        `${filePath}:0`,
      filePath,
      chunkType: 'file',
      scope:     null,
      name:      null,
      content,
      startLine: 1,
      endLine:   content.split('\n').length,
    });
  }

  log.debug({ filePath, chunkCount: chunks.length }, 'File chunked');

  return chunks;
}
