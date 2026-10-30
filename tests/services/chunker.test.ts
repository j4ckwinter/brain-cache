import { describe, it, expect } from 'vitest';
import { chunkFile, GRAMMAR_WASM, CHUNK_NODE_TYPES } from '../../src/services/chunker.js';

describe('GRAMMAR_WASM', () => {
  it('maps .ts to typescript wasm', () => {
    expect(GRAMMAR_WASM['.ts']).toBe('tree-sitter-typescript.wasm');
  });

  it('maps .tsx to tsx wasm', () => {
    expect(GRAMMAR_WASM['.tsx']).toBe('tree-sitter-tsx.wasm');
  });

  it('maps .js to typescript wasm', () => {
    expect(GRAMMAR_WASM['.js']).toBe('tree-sitter-typescript.wasm');
  });

  it('maps .jsx to tsx wasm', () => {
    expect(GRAMMAR_WASM['.jsx']).toBe('tree-sitter-tsx.wasm');
  });

  it('maps .py to python wasm', () => {
    expect(GRAMMAR_WASM['.py']).toBe('tree-sitter-python.wasm');
  });

  it('maps .go to go wasm', () => {
    expect(GRAMMAR_WASM['.go']).toBe('tree-sitter-go.wasm');
  });

  it('maps .rs to rust wasm', () => {
    expect(GRAMMAR_WASM['.rs']).toBe('tree-sitter-rust.wasm');
  });
});

describe('CHUNK_NODE_TYPES', () => {
  it('has typescript category', () => {
    expect(CHUNK_NODE_TYPES['typescript']).toBeDefined();
    expect(CHUNK_NODE_TYPES['typescript']).toBeInstanceOf(Set);
  });

  it('typescript includes function_declaration', () => {
    expect(CHUNK_NODE_TYPES['typescript'].has('function_declaration')).toBe(true);
  });

  it('typescript includes class_declaration', () => {
    expect(CHUNK_NODE_TYPES['typescript'].has('class_declaration')).toBe(true);
  });

  it('has python category', () => {
    expect(CHUNK_NODE_TYPES['python']).toBeInstanceOf(Set);
    expect(CHUNK_NODE_TYPES['python'].has('function_definition')).toBe(true);
  });

  it('has go category', () => {
    expect(CHUNK_NODE_TYPES['go']).toBeInstanceOf(Set);
    expect(CHUNK_NODE_TYPES['go'].has('function_declaration')).toBe(true);
  });

  it('has rust category', () => {
    expect(CHUNK_NODE_TYPES['rust']).toBeInstanceOf(Set);
    expect(CHUNK_NODE_TYPES['rust'].has('function_item')).toBe(true);
  });
});

describe('chunkFile - TypeScript', () => {
  it('extracts function declaration', async () => {
    const src = `export function greet(name: string): string { return 'hi ' + name; }`;
    const { chunks } = await chunkFile('test.ts', src);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const fn = chunks.find(c => c.chunkType === 'function' && c.name === 'greet');
    expect(fn).toBeDefined();
    expect(fn!.chunkType).toBe('function');
    expect(fn!.name).toBe('greet');
  });

  it('extracts class declaration and method', async () => {
    const src = `export class Foo { bar() { return 1; } }`;
    const { chunks } = await chunkFile('test.ts', src);
    const classChunk = chunks.find(c => c.chunkType === 'class' && c.name === 'Foo');
    const methodChunk = chunks.find(c => c.chunkType === 'method' && c.name === 'bar');
    expect(classChunk).toBeDefined();
    expect(methodChunk).toBeDefined();
  });

  it('extracts exported arrow function (top-level)', async () => {
    const src = `export const add = (a: number, b: number) => a + b;`;
    const { chunks } = await chunkFile('test.ts', src);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const fnChunk = chunks.find(c => c.chunkType === 'function');
    expect(fnChunk).toBeDefined();
  });

  it('returns fallback file chunk for type-only file', async () => {
    const src = `export interface User { id: string; name: string; }\nexport type ID = string;`;
    const { chunks } = await chunkFile('types.ts', src);
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkType).toBe('file');
    expect(chunks[0].content).toContain('interface User');
  });

  it('chunk has correct line numbers', async () => {
    const src = `function foo() {\n  return 1;\n}`;
    const { chunks } = await chunkFile('test.ts', src);
    const fn = chunks.find(c => c.chunkType === 'function' && c.name === 'foo');
    expect(fn).toBeDefined();
    expect(fn!.startLine).toBe(1);
    expect(fn!.endLine).toBe(3);
  });

  it('each chunk has valid content, startLine, endLine', async () => {
    const src = `export function hello() { return 'world'; }`;
    const { chunks } = await chunkFile('test.ts', src);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.startLine).toBeGreaterThanOrEqual(1);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });

  it('each chunk has an id field', async () => {
    const src = `export function foo() { return 1; }`;
    const { chunks } = await chunkFile('test.ts', src);
    for (const chunk of chunks) {
      expect(chunk.id).toBeDefined();
      expect(chunk.id.length).toBeGreaterThan(0);
    }
  });
});

describe('chunkFile - Python', () => {
  it('extracts function_definition', async () => {
    const src = `def hello():\n    return "world"`;
    const { chunks } = await chunkFile('test.py', src);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const fn = chunks.find(c => c.chunkType === 'function' && c.name === 'hello');
    expect(fn).toBeDefined();
  });

  it('extracts class_definition', async () => {
    const src = `class MyClass:\n    def method(self):\n        pass`;
    const { chunks } = await chunkFile('test.py', src);
    const cls = chunks.find(c => c.chunkType === 'class' && c.name === 'MyClass');
    expect(cls).toBeDefined();
  });
});

describe('chunkFile - Go', () => {
  it('extracts function_declaration', async () => {
    const src = `package main\n\nfunc main() {\n    fmt.Println("hello")\n}`;
    const { chunks } = await chunkFile('test.go', src);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const fn = chunks.find(c => c.chunkType === 'function' && c.name === 'main');
    expect(fn).toBeDefined();
  });
});

describe('chunkFile - Rust', () => {
  it('extracts function_item', async () => {
    const src = `fn main() {\n    println!("hello");\n}`;
    const { chunks } = await chunkFile('test.rs', src);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const fn = chunks.find(c => c.chunkType === 'function' && c.name === 'main');
    expect(fn).toBeDefined();
  });
});

describe('chunkFile - documentation', () => {
  it('chunks markdown with ## sections', async () => {
    const { chunks, edges } = await chunkFile(
      'readme.md',
      '## Hello\n\nWorld\n\n## Bye\n\nLater',
    );
    expect(edges).toEqual([]);
    expect(chunks.map((c) => c.name)).toContain('Hello');
    expect(chunks.map((c) => c.name)).toContain('Bye');
  });

  it('chunks plain text with paragraph breaks', async () => {
    const { chunks, edges } = await chunkFile('notes.txt', 'para1\n\npara2');
    expect(edges).toEqual([]);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty chunks for unknown extension', async () => {
    const { chunks } = await chunkFile('unknown.xyz', 'content');
    expect(chunks).toEqual([]);
  });
});

describe('chunkFile - unsupported', () => {
  it('returns empty chunks for .json extension', async () => {
    const { chunks } = await chunkFile('data.json', '{"key": "value"}');
    expect(chunks).toEqual([]);
  });
});

describe('arrow function extraction', () => {
  it('extracts top-level exported arrow function', async () => {
    const code = `export const greet = (name: string): string => {\n  return 'hello ' + name;\n};\n`;
    const { chunks } = await chunkFile('test.ts', code);
    expect(chunks.some(c => c.chunkType === 'function')).toBe(true);
  });

  it('extracts top-level non-exported arrow function', async () => {
    const code = `const add = (a: number, b: number) => a + b;\n`;
    const { chunks } = await chunkFile('test.ts', code);
    expect(chunks.some(c => c.chunkType === 'function')).toBe(true);
  });

  it('does NOT extract arrow function used as callback argument', async () => {
    const code = `const arr = [1, 2, 3];\nconst result = arr.map((x) => x * 2);\n`;
    const { chunks } = await chunkFile('test.ts', code);
    // The map callback arrow should not be extracted as a standalone chunk
    const arrowChunks = chunks.filter(c => c.chunkType === 'function');
    expect(arrowChunks.length).toBe(0);
  });

  it('does NOT extract deeply nested arrow function', async () => {
    const code = [
      'function outer() {',
      '  function middle() {',
      '    const items = [1, 2, 3];',
      '    items.forEach((item) => {',
      '      console.log(item);',
      '    });',
      '  }',
      '}',
    ].join('\n');
    const { chunks } = await chunkFile('test.ts', code);
    const arrowChunks = chunks.filter(c => c.content.includes('=>'));
    // Only the named functions should be extracted, not the forEach callback
    expect(arrowChunks.every(c => c.name === 'outer' || c.name === 'middle')).toBe(true);
  });
});

describe('structural chunk identity and call ownership', () => {
  it('keeps same-line classes, methods, and sibling functions distinct and deterministic', async () => {
    const source = 'class A { one() { first(); } two() { second(); } } function sibling() { third(); }';
    const result = await chunkFile('same.ts', source);
    expect(result.chunks.map(c => c.name)).toEqual(['A', 'one', 'two', 'sibling']);
    expect(new Set(result.chunks.map(c => c.id)).size).toBe(4);
    expect((await chunkFile('same.ts', source)).chunks.map(c => c.id))
      .toEqual(result.chunks.map(c => c.id));
    for (const [owner, target] of [['one', 'first'], ['two', 'second'], ['sibling', 'third']]) {
      const chunk = result.chunks.find(c => c.name === owner)!;
      expect(result.edges.filter(e => e.fromChunkId === chunk.id).map(e => e.toSymbol)).toEqual([target]);
    }
  });

  it('restores enclosing ownership after nested functions and resets ownership at module scope', async () => {
    const { chunks, edges } = await chunkFile('nested.ts', [
      'function outer() {',
      '  before();',
      '  function inner() { inside(); }',
      '  after();',
      '  items.map(() => callback());',
      '}',
      'moduleCall();',
    ].join('\n'));
    expect(chunks.map(c => c.name)).toEqual(['outer', 'inner']);
    const outer = chunks.find(c => c.name === 'outer')!;
    const inner = chunks.find(c => c.name === 'inner')!;
    expect(edges.filter(e => e.fromChunkId === outer.id).map(e => e.toSymbol))
      .toEqual(['before', 'after', 'map', 'callback']);
    expect(edges.filter(e => e.fromChunkId === inner.id).map(e => e.toSymbol)).toEqual(['inside']);
    expect(edges.find(e => e.toSymbol === 'moduleCall')).toMatchObject({ fromSymbol: null, fromChunkId: 'nested.ts:file' });
  });

  it('separates first-line structural chunks from file calls and imports', async () => {
    const { chunks, edges } = await chunkFile('first.ts', 'import { x } from "./dep"; boot(); function f() { inside(); } tail();');
    const fn = chunks.find(c => c.name === 'f')!;
    expect(fn.id).not.toBe('first.ts:file');
    expect(edges.filter(e => e.fromChunkId === fn.id).map(e => e.toSymbol)).toEqual(['inside']);
    expect(edges.filter(e => e.fromChunkId === 'first.ts:file').map(e => [e.fromSymbol, e.toSymbol]))
      .toEqual([[null, './dep'], [null, 'boot'], [null, 'tail']]);
    const fallback = await chunkFile('fallback.ts', 'boot();');
    expect(fallback.chunks[0].id).toBe('fallback.ts:file');
    expect(fallback.edges[0].fromChunkId).toBe(fallback.chunks[0].id);
  });

  it('names admitted arrows from identifier declarators and uses that name for their calls', async () => {
    const { chunks, edges } = await chunkFile('arrow.ts', 'const local = () => first(); export const exposed = () => second();');
    expect(chunks.map(c => c.name)).toEqual(['local', 'exposed']);
    expect(edges.map(e => [e.fromSymbol, e.toSymbol])).toEqual([['local', 'first'], ['exposed', 'second']]);
    expect(edges.map(e => e.fromChunkId)).toEqual(chunks.map(c => c.id));
    const destructured = await chunkFile('pattern.ts', 'const [item] = () => target();');
    expect(destructured.chunks[0].name).toBeNull();
  });
});

describe('mixed-file declarations', () => {
  it.each([
    ['ts', 'export interface User { id: string }\nexport type ID = string;\nexport const MAX_RETRIES = 3, MIN_RETRIES = 1;\nfunction retry() { return MAX_RETRIES; }', ['User', 'ID', 'MAX_RETRIES', 'MIN_RETRIES', 'retry']],
    ['py', 'MAX_RETRIES = 3\ndef retry():\n    return MAX_RETRIES\n', ['MAX_RETRIES', 'retry']],
    ['go', 'package main\ntype User struct { ID string }\nconst MAX_RETRIES = 3\nfunc retry() int { return MAX_RETRIES }', ['User', 'MAX_RETRIES', 'retry']],
    ['rs', 'struct User { id: String }\nconst MAX_RETRIES: usize = 3;\nfn retry() -> usize { MAX_RETRIES }', ['User', 'MAX_RETRIES', 'retry']],
  ])('retains named declarations alongside functions in %s', async (ext, source, names) => {
    const { chunks } = await chunkFile(`mixed.${ext}`, source);
    for (const name of names) {
      expect(chunks.find(chunk => chunk.name === name), name).toBeDefined();
    }
    expect(new Set(chunks.map(chunk => chunk.id)).size).toBe(chunks.length);
    for (const chunk of chunks) {
      expect(source.split('\n').slice(chunk.startLine - 1, chunk.endLine).join('\n')).toContain(chunk.content);
    }
  });
});

it('retains object configuration and function aliases without duplicating named arrows', async () => {
  const source = 'export const SETTINGS = { retries: 3, run() { return true; } };\nconst alias = function implementation() {};\nconst arrow = () => {};';
  const { chunks } = await chunkFile('config.ts', source);
  expect(chunks.find(chunk => chunk.name === 'SETTINGS')?.content).toContain('retries: 3');
  expect(chunks.find(chunk => chunk.name === 'alias')?.content).toContain('implementation');
  expect(chunks.filter(chunk => chunk.name === 'arrow')).toHaveLength(1);
});

it('retains Rust trait signatures alongside default method bodies', async () => {
  const { chunks } = await chunkFile('trait.rs', 'trait Cache { fn get(&self); fn ready(&self) -> bool { true } }');
  expect(chunks.find(chunk => chunk.name === 'Cache')?.content).toContain('fn get(&self)');
  expect(chunks.find(chunk => chunk.name === 'ready')).toBeDefined();
});
