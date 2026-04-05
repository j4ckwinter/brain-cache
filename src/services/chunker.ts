import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve } from 'node:path';
import { Parser, Language, type Node } from 'web-tree-sitter';
import { childLogger } from './logger.js';
import type { CodeChunk, CallEdge, ChunkResult } from '../lib/types.js';

// Captured at module scope — esbuild rewrites import.meta.url inside callbacks.
const __dir = dirname(fileURLToPath(import.meta.url));

const log = childLogger('chunker');

// Singleton init guard — Parser.init() must run exactly once per process (PARSE-01).
let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (initPromise === null) {
    initPromise = Parser.init({
      locateFile(scriptName: string) {
        return join(__dir, 'wasm', scriptName);
      },
    });
  }
  return initPromise;
}

// Maps file extensions to WASM grammar filenames bundled in dist/wasm/ (PARSE-02).
export const GRAMMAR_WASM: Partial<Record<string, string>> = {
  '.ts':  'tree-sitter-typescript.wasm',
  '.tsx': 'tree-sitter-tsx.wasm',
  '.mts': 'tree-sitter-typescript.wasm',
  '.cts': 'tree-sitter-typescript.wasm',
  '.js':  'tree-sitter-typescript.wasm',
  '.jsx': 'tree-sitter-tsx.wasm',
  '.mjs': 'tree-sitter-typescript.wasm',
  '.cjs': 'tree-sitter-typescript.wasm',
  '.py':  'tree-sitter-python.wasm',
  '.pyi': 'tree-sitter-python.wasm',
  '.go':  'tree-sitter-go.wasm',
  '.rs':  'tree-sitter-rust.wasm',
};

// Grammar cache — each wasm file is loaded once per process (PARSE-02).
const languageCache = new Map<string, Language>();

async function loadLanguage(ext: string): Promise<Language | null> {
  if (languageCache.has(ext)) return languageCache.get(ext)!;
  const wasmFile = GRAMMAR_WASM[ext];
  if (!wasmFile) return null;
  const wasmPath = join(__dir, 'wasm', wasmFile);
  try {
    const lang = await Language.load(wasmPath);
    languageCache.set(ext, lang);
    return lang;
  } catch (err) {
    throw new Error(
      `brain-cache: failed to load grammar for '${ext}' from '${wasmPath}'. ` +
      `Ensure 'npm run build' has run (postbuild copies WASM files). ` +
      `Original error: ${String(err)}`
    );
  }
}

// web-tree-sitter Node type alias.
type SyntaxNode = Node;

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
 * Parses source code at AST function/class/method boundaries and returns ChunkResult.
 *
 * Returns empty chunks/edges for unsupported file extensions.
 * Returns a single file-type fallback chunk if no AST nodes are extractable (e.g. type-only files).
 * Call edges are extracted from call_expression nodes in the same walkNodes traversal.
 * Import edges are extracted from import_statement nodes in the same walkNodes traversal.
 * Dynamic call targets (subscript_expression, etc.) are silently skipped.
 */
export async function chunkFile(filePath: string, content: string): Promise<ChunkResult> {
  const ext = extname(filePath);

  await ensureInit();
  const lang = await loadLanguage(ext);

  if (!lang) {
    return { chunks: [], edges: [] };
  }

  const category = getLanguageCategory(ext);
  const nodeTypes = CHUNK_NODE_TYPES[category];

  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(content);

  if (!tree) {
    return { chunks: [], edges: [] };
  }

  const chunks: CodeChunk[] = [];
  const edges: CallEdge[] = [];

  let currentChunkId: string | null = null;
  let currentSymbol: string | null = null;

  try {
    for (const node of walkNodes(tree.rootNode)) {
      // Extract call edges from call_expression nodes (runs for ALL nodes)
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');
        if (funcNode) {
          let toSymbol: string | null = null;
          if (funcNode.type === 'identifier') {
            toSymbol = funcNode.text;
          } else if (funcNode.type === 'member_expression' || funcNode.type === 'optional_member_expression') {
            toSymbol = funcNode.childForFieldName('property')?.text ?? null;
          }
          // Skip dynamic call targets (subscript_expression, etc.) per pitfall 6
          if (toSymbol) {
            const chunkId = currentChunkId ?? `${filePath}:0`;
            const symbol = currentSymbol;
            edges.push({
              fromChunkId: chunkId,
              fromFile: filePath,
              fromSymbol: symbol,
              toSymbol,
              toFile: null, // Resolved at query time, not index time
              edgeType: 'call',
            });
          }
        }
      }

      // Extract import edges from import_statement nodes (runs for ALL nodes)
      if (node.type === 'import_statement') {
        const source = node.childForFieldName('source');
        if (source) {
          const raw = source.text.replace(/['"]/g, '');
          const isRelative = raw.startsWith('./') || raw.startsWith('../');
          const toFile = isRelative ? resolve(dirname(filePath), raw) : null;
          edges.push({
            fromChunkId: `${filePath}:0`,
            fromFile: filePath,
            fromSymbol: null,
            toSymbol: raw,
            toFile,
            edgeType: 'import',
          });
        }
      }

      // Chunk extraction: only for chunkable node types
      if (!nodeTypes.has(node.type)) {
        continue;
      }

      // For arrow functions: only extract top-level or exported ones.
      // Check parent node types structurally rather than counting depth,
      // which is fragile when AST nesting varies (e.g., if blocks, IIFEs).
      //
      // Admitted patterns:
      //   export const fn = () => {}  → export_statement > lexical_declaration > variable_declarator > arrow_function
      //   const fn = () => {}         → program > lexical_declaration > variable_declarator > arrow_function
      if (node.type === 'arrow_function') {
        const varDeclarator = node.parent;
        const lexDecl = varDeclarator?.parent;
        const container = lexDecl?.parent;

        const isTopLevelConst =
          varDeclarator?.type === 'variable_declarator' &&
          lexDecl?.type === 'lexical_declaration' &&
          (container?.type === 'program' || container?.type === 'export_statement');

        if (!isTopLevelConst) {
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

      // Update currentChunkId tracking for associating call_expressions with their enclosing chunk
      currentChunkId = `${filePath}:${node.startPosition.row}`;
      currentSymbol = extractName(node);
    }
  } finally {
    tree.delete();
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

  log.debug({ filePath, chunkCount: chunks.length, edgeCount: edges.length }, 'File chunked');

  return { chunks, edges };
}
