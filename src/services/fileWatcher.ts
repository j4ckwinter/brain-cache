import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { relative } from 'node:path';
import ignore from 'ignore';
import { loadIgnorePatterns } from './ignorePatterns.js';
import { ALWAYS_EXCLUDE_GLOBS } from './crawler.js';

/**
 * Creates a chokidar FSWatcher for the given project root.
 * Excludes:
 * - The .brain-cache/ directory (to prevent infinite re-index loops)
 * - Patterns from .braincacheignore
 * - ALWAYS_EXCLUDE_GLOBS (node_modules, dist, .git, etc.)
 */
export async function createWatcher(projectRoot: string): Promise<FSWatcher> {
  const userPatterns = await loadIgnorePatterns(projectRoot);

  const ig = ignore();
  ig.add(userPatterns);
  // ALWAYS_EXCLUDE_GLOBS uses **/ prefix patterns — ignore package handles these
  ig.add(ALWAYS_EXCLUDE_GLOBS);

  const ignored = (filePath: string): boolean => {
    // Always exclude the .brain-cache directory itself
    if (filePath.includes('/.brain-cache/') || filePath.endsWith('/.brain-cache')) {
      return true;
    }

    const rel = relative(projectRoot, filePath);
    // If relative path is empty or escapes root, don't ignore
    if (!rel || rel.startsWith('..')) {
      return false;
    }

    return ig.ignores(rel);
  };

  return watch(projectRoot, {
    persistent: true,
    ignoreInitial: true,
    ignored,
  });
}
