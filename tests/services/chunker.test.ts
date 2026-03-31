import { describe, it, expect } from 'vitest';
import { chunkFile, LANGUAGE_MAP, CHUNK_NODE_TYPES } from '../../src/services/chunker.js';

describe('LANGUAGE_MAP', () => {
  it('maps .ts to a language object', () => {
    expect(LANGUAGE_MAP['.ts']).toBeDefined();
  });

  it('maps .tsx to a language object', () => {
    expect(LANGUAGE_MAP['.tsx']).toBeDefined();
  });

  it('maps .js to a language object', () => {
    expect(LANGUAGE_MAP['.js']).toBeDefined();
  });

  it('maps .jsx to a language object', () => {
    expect(LANGUAGE_MAP['.jsx']).toBeDefined();
  });

  it('maps .py to a language object', () => {
    expect(LANGUAGE_MAP['.py']).toBeDefined();
  });

  it('maps .go to a language object', () => {
    expect(LANGUAGE_MAP['.go']).toBeDefined();
  });

  it('maps .rs to a language object', () => {
    expect(LANGUAGE_MAP['.rs']).toBeDefined();
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
  it('extracts function declaration', () => {
    const src = `export function greet(name: string): string { return 'hi ' + name; }`;
    const chunks = chunkFile('test.ts', src);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const fn = chunks.find(c => c.chunkType === 'function' && c.name === 'greet');
    expect(fn).toBeDefined();
    expect(fn!.chunkType).toBe('function');
    expect(fn!.name).toBe('greet');
  });

  it('extracts class declaration and method', () => {
    const src = `export class Foo { bar() { return 1; } }`;
    const chunks = chunkFile('test.ts', src);
    const classChunk = chunks.find(c => c.chunkType === 'class' && c.name === 'Foo');
    const methodChunk = chunks.find(c => c.chunkType === 'method' && c.name === 'bar');
    expect(classChunk).toBeDefined();
    expect(methodChunk).toBeDefined();
  });

  it('extracts exported arrow function (top-level)', () => {
    const src = `export const add = (a: number, b: number) => a + b;`;
    const chunks = chunkFile('test.ts', src);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const fnChunk = chunks.find(c => c.chunkType === 'function');
    expect(fnChunk).toBeDefined();
  });

  it('returns fallback file chunk for type-only file', () => {
    const src = `export interface User { id: string; name: string; }\nexport type ID = string;`;
    const chunks = chunkFile('types.ts', src);
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkType).toBe('file');
    expect(chunks[0].content).toContain('interface User');
  });

  it('chunk has correct line numbers', () => {
    const src = `function foo() {\n  return 1;\n}`;
    const chunks = chunkFile('test.ts', src);
    const fn = chunks.find(c => c.chunkType === 'function' && c.name === 'foo');
    expect(fn).toBeDefined();
    expect(fn!.startLine).toBe(1);
    expect(fn!.endLine).toBe(3);
  });

  it('each chunk has valid content, startLine, endLine', () => {
    const src = `export function hello() { return 'world'; }`;
    const chunks = chunkFile('test.ts', src);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.startLine).toBeGreaterThanOrEqual(1);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });

  it('each chunk has an id field', () => {
    const src = `export function foo() { return 1; }`;
    const chunks = chunkFile('test.ts', src);
    for (const chunk of chunks) {
      expect(chunk.id).toBeDefined();
      expect(chunk.id.length).toBeGreaterThan(0);
    }
  });
});

describe('chunkFile - Python', () => {
  it('extracts function_definition', () => {
    const src = `def hello():\n    return "world"`;
    const chunks = chunkFile('test.py', src);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const fn = chunks.find(c => c.chunkType === 'function' && c.name === 'hello');
    expect(fn).toBeDefined();
  });

  it('extracts class_definition', () => {
    const src = `class MyClass:\n    def method(self):\n        pass`;
    const chunks = chunkFile('test.py', src);
    const cls = chunks.find(c => c.chunkType === 'class' && c.name === 'MyClass');
    expect(cls).toBeDefined();
  });
});

describe('chunkFile - Go', () => {
  it('extracts function_declaration', () => {
    const src = `package main\n\nfunc main() {\n    fmt.Println("hello")\n}`;
    const chunks = chunkFile('test.go', src);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const fn = chunks.find(c => c.chunkType === 'function' && c.name === 'main');
    expect(fn).toBeDefined();
  });
});

describe('chunkFile - Rust', () => {
  it('extracts function_item', () => {
    const src = `fn main() {\n    println!("hello");\n}`;
    const chunks = chunkFile('test.rs', src);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const fn = chunks.find(c => c.chunkType === 'function' && c.name === 'main');
    expect(fn).toBeDefined();
  });
});

describe('chunkFile - unsupported', () => {
  it('returns empty array for .txt extension', () => {
    const chunks = chunkFile('readme.txt', 'some text here');
    expect(chunks).toEqual([]);
  });

  it('returns empty array for .json extension', () => {
    const chunks = chunkFile('data.json', '{"key": "value"}');
    expect(chunks).toEqual([]);
  });

  it('returns empty array for .md extension', () => {
    const chunks = chunkFile('README.md', '# Title\n\nSome text.');
    expect(chunks).toEqual([]);
  });
});
