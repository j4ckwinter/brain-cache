import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { crawlSourceFiles, SOURCE_EXTENSIONS, ALWAYS_EXCLUDE_GLOBS } from '../../src/services/crawler.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `crawler-test-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('SOURCE_EXTENSIONS', () => {
  it('contains .ts, .tsx, .js, .jsx, .py, .go, .rs, .md, .txt, .rst', () => {
    expect(SOURCE_EXTENSIONS.has('.ts')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.tsx')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.js')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.jsx')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.py')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.go')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.rs')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.md')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.txt')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.rst')).toBe(true);
  });
});

describe('ALWAYS_EXCLUDE_GLOBS', () => {
  it('contains node_modules, .git, dist exclusion globs', () => {
    expect(ALWAYS_EXCLUDE_GLOBS).toContain('**/node_modules/**');
    expect(ALWAYS_EXCLUDE_GLOBS).toContain('**/.git/**');
    expect(ALWAYS_EXCLUDE_GLOBS).toContain('**/dist/**');
  });
});

describe('crawlSourceFiles', () => {
  it('Test 1: returns only files with SOURCE_EXTENSIONS', async () => {
    // Create source files and non-source files
    await writeFile(join(tempDir, 'index.ts'), '// ts file');
    await writeFile(join(tempDir, 'app.py'), '# python file');
    await writeFile(join(tempDir, 'main.go'), '// go file');
    await writeFile(join(tempDir, 'README.md'), '# readme');
    await writeFile(join(tempDir, 'data.json'), '{}');
    await writeFile(join(tempDir, 'image.png'), 'fake binary');

    const files = await crawlSourceFiles(tempDir);

    const basenames = files.map(f => f.split('/').pop()!);
    expect(basenames).toContain('index.ts');
    expect(basenames).toContain('app.py');
    expect(basenames).toContain('main.go');
    expect(basenames).toContain('README.md');
    expect(basenames).not.toContain('data.json');
    expect(basenames).not.toContain('image.png');
  });

  it('Test 2: excludes node_modules, .git, dist, build, __pycache__ directories', async () => {
    // Create real source files in excluded directories
    await mkdir(join(tempDir, 'node_modules', 'some-pkg'), { recursive: true });
    await writeFile(join(tempDir, 'node_modules', 'some-pkg', 'index.ts'), '// should be excluded');

    await mkdir(join(tempDir, '.git'), { recursive: true });
    await writeFile(join(tempDir, '.git', 'config.ts'), '// should be excluded');

    await mkdir(join(tempDir, 'dist'), { recursive: true });
    await writeFile(join(tempDir, 'dist', 'bundle.js'), '// should be excluded');

    await mkdir(join(tempDir, 'build'), { recursive: true });
    await writeFile(join(tempDir, 'build', 'output.ts'), '// should be excluded');

    await mkdir(join(tempDir, '__pycache__'), { recursive: true });
    await writeFile(join(tempDir, '__pycache__', 'module.py'), '# should be excluded');

    // A real source file that should be included
    await writeFile(join(tempDir, 'src.ts'), '// real source');

    const files = await crawlSourceFiles(tempDir);

    const basenames = files.map(f => f.split('/').pop()!);
    expect(basenames).toContain('src.ts');
    expect(basenames).not.toContain('index.ts'); // from node_modules
    expect(files.some(f => f.includes('/node_modules/'))).toBe(false);
    expect(files.some(f => f.includes('/.git/'))).toBe(false);
    expect(files.some(f => f.includes('/dist/'))).toBe(false);
    expect(files.some(f => f.includes('/build/'))).toBe(false);
    expect(files.some(f => f.includes('/__pycache__/'))).toBe(false);
  });

  it('Test 3: respects .gitignore patterns', async () => {
    // Create .gitignore that excludes generated/
    await writeFile(join(tempDir, '.gitignore'), 'generated/\n*.generated.ts\n');

    await mkdir(join(tempDir, 'generated'), { recursive: true });
    await writeFile(join(tempDir, 'generated', 'client.ts'), '// gitignored file');
    await writeFile(join(tempDir, 'api.generated.ts'), '// gitignored file');

    // A real source file that should NOT be gitignored
    await writeFile(join(tempDir, 'main.ts'), '// real source');

    const files = await crawlSourceFiles(tempDir);

    const basenames = files.map(f => f.split('/').pop()!);
    expect(basenames).toContain('main.ts');
    expect(basenames).not.toContain('client.ts');
    expect(basenames).not.toContain('api.generated.ts');
  });

  it('Test 4: returns absolute paths', async () => {
    await writeFile(join(tempDir, 'index.ts'), '// ts file');

    const files = await crawlSourceFiles(tempDir);

    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.startsWith('/')).toBe(true); // absolute path starts with /
    }
  });

  it('Test 5: returns only doc files when no code files exist', async () => {
    await writeFile(join(tempDir, 'README.md'), '# readme');
    await writeFile(join(tempDir, 'config.json'), '{}');

    const files = await crawlSourceFiles(tempDir);
    const basenames = files.map(f => f.split('/').pop()!);
    expect(basenames).toContain('README.md');
    expect(basenames).not.toContain('config.json');
  });

  it('Test 6: excludes lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, Cargo.lock)', async () => {
    // Lock files don't have source extensions, but let's verify the exclusion globs work
    // by creating them and checking they're not included
    await writeFile(join(tempDir, 'package-lock.json'), '{}');
    await writeFile(join(tempDir, 'yarn.lock'), 'lockfile');
    await writeFile(join(tempDir, 'pnpm-lock.yaml'), 'lockfile');
    await writeFile(join(tempDir, 'Cargo.lock'), 'lockfile');
    await writeFile(join(tempDir, 'index.ts'), '// source');

    const files = await crawlSourceFiles(tempDir);

    const basenames = files.map(f => f.split('/').pop()!);
    expect(basenames).not.toContain('package-lock.json');
    expect(basenames).not.toContain('yarn.lock');
    expect(basenames).not.toContain('pnpm-lock.yaml');
    expect(basenames).not.toContain('Cargo.lock');
    expect(basenames).toContain('index.ts');
  });

  it('Test 7: excludes .min.js files', async () => {
    await writeFile(join(tempDir, 'app.min.js'), '// minified');
    await writeFile(join(tempDir, 'app.js'), '// real source');

    const files = await crawlSourceFiles(tempDir);

    const basenames = files.map(f => f.split('/').pop()!);
    expect(basenames).not.toContain('app.min.js');
    expect(basenames).toContain('app.js');
  });
});

describe('crawlSourceFiles with extraIgnorePatterns', () => {
  it('excludes .test.ts files when extraIgnorePatterns contains *.test.ts', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'app.ts'), 'export const x = 1;');
    await writeFile(join(tempDir, 'src', 'app.test.ts'), 'export const x = 1;');

    const files = await crawlSourceFiles(tempDir, { extraIgnorePatterns: ['*.test.ts'] });

    const basenames = files.map(f => f.split('/').pop()!);
    expect(basenames).toContain('app.ts');
    expect(basenames).not.toContain('app.test.ts');
  });

  it('excludes files in fixtures/ directory when extraIgnorePatterns contains fixtures/', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await mkdir(join(tempDir, 'fixtures'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'app.ts'), 'export const x = 1;');
    await writeFile(join(tempDir, 'src', 'app.test.ts'), 'export const x = 1;');
    await writeFile(join(tempDir, 'fixtures', 'data.ts'), 'export const x = 1;');

    const files = await crawlSourceFiles(tempDir, { extraIgnorePatterns: ['fixtures/'] });

    const basenames = files.map(f => f.split('/').pop()!);
    expect(basenames).toContain('app.ts');
    expect(basenames).toContain('app.test.ts');
    expect(basenames).not.toContain('data.ts');
  });

  it('returns all files when no opts are provided (backward compat)', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await mkdir(join(tempDir, 'fixtures'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'app.ts'), 'export const x = 1;');
    await writeFile(join(tempDir, 'src', 'app.test.ts'), 'export const x = 1;');
    await writeFile(join(tempDir, 'fixtures', 'data.ts'), 'export const x = 1;');

    const files = await crawlSourceFiles(tempDir);

    const basenames = files.map(f => f.split('/').pop()!);
    expect(basenames).toContain('app.ts');
    expect(basenames).toContain('app.test.ts');
    expect(basenames).toContain('data.ts');
  });
});
