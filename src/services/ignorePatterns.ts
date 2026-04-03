import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Loads custom exclusion patterns from a .braincacheignore file in the given directory.
 * Returns an empty array if no .braincacheignore file exists.
 * Lines starting with # are treated as comments and ignored.
 * Empty/whitespace-only lines are ignored.
 * Pattern format follows .gitignore syntax (processed by the `ignore` package).
 */
export async function loadIgnorePatterns(rootDir: string): Promise<string[]> {
  try {
    const content = await readFile(join(rootDir, '.braincacheignore'), 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim() !== '' && !line.startsWith('#'));
  } catch {
    return [];
  }
}
