import fg from 'fast-glob';
import ignore from 'ignore';
import { readFile } from 'node:fs/promises';
import { extname, relative } from 'node:path';
import { childLogger } from './logger.js';

const log = childLogger('crawler');

export const SOURCE_EXTENSIONS = new Set<string>([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi',
  '.go',
  '.rs',
  '.md',
  '.txt',
  '.rst',
]);

export const ALWAYS_EXCLUDE_GLOBS: string[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/__pycache__/**',
  '**/*.egg-info/**',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/Cargo.lock',
  '**/*.min.js',
];

export async function crawlSourceFiles(
  rootDir: string,
  opts?: { extraIgnorePatterns?: string[] }
): Promise<string[]> {
  const ig = ignore();

  try {
    const gitignoreContent = await readFile(`${rootDir}/.gitignore`, 'utf-8');
    ig.add(gitignoreContent);
  } catch {
    // no .gitignore — skip
  }

  if (opts?.extraIgnorePatterns?.length) {
    ig.add(opts.extraIgnorePatterns);
  }

  const files = await fg('**/*', {
    cwd: rootDir,
    absolute: true,
    ignore: ALWAYS_EXCLUDE_GLOBS,
    onlyFiles: true,
  });

  const result = files.filter(f => {
    const ext = extname(f);
    if (!SOURCE_EXTENSIONS.has(ext)) return false;
    const rel = relative(rootDir, f);
    return !ig.ignores(rel);
  });

  log.info({ rootDir, fileCount: result.length }, 'Crawl complete');

  return result;
}
