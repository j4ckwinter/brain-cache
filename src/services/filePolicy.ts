import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import ignore from 'ignore';

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

const EXCLUDED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);

export const ALWAYS_EXCLUDE_GLOBS: string[] = [
  ...[...EXCLUDED_DIRECTORIES].map(name => `**/${name}/**`),
  '**/*.egg-info/**',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/Cargo.lock',
  '**/*.min.js',
];

export const IGNORE_FILENAMES = ['.gitignore', '.braincacheignore'];

export async function loadSourceIgnore(rootDir: string, extraPatterns: string[] = []): Promise<ReturnType<typeof ignore>> {
  const ig = ignore();
  for (const filename of IGNORE_FILENAMES) {
    try {
      ig.add(await readFile(join(rootDir, filename), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  ig.add(extraPatterns);
  return ig;
}

export function isEligibleSourcePath(relativePath: string, ig: ReturnType<typeof ignore>): boolean {
  if (!relativePath) return false;
  const normalized = relativePath.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.some(part => part.startsWith('.') || EXCLUDED_DIRECTORIES.has(part) || part.endsWith('.egg-info'))) return false;
  if (!SOURCE_EXTENSIONS.has(extname(normalized)) || normalized.endsWith('.min.js')) return false;
  return !ig.ignores(normalized);
}
