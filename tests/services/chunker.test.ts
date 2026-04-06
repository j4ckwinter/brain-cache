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
