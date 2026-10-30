import fg from 'fast-glob';
import { relative } from 'node:path';
import { childLogger } from './logger.js';
import { ALWAYS_EXCLUDE_GLOBS, isEligibleSourcePath, loadSourceIgnore } from './filePolicy.js';
export { SOURCE_EXTENSIONS, ALWAYS_EXCLUDE_GLOBS } from './filePolicy.js';

const log = childLogger('crawler');

export async function crawlSourceFiles(
  rootDir: string,
  opts?: { extraIgnorePatterns?: string[] }
): Promise<string[]> {
  const ig = await loadSourceIgnore(rootDir, opts?.extraIgnorePatterns);

  const files = await fg('**/*', {
    cwd: rootDir,
    absolute: true,
    ignore: ALWAYS_EXCLUDE_GLOBS,
    onlyFiles: true,
  });

  const result = files.filter(file => isEligibleSourcePath(relative(rootDir, file), ig));

  log.info({ rootDir, fileCount: result.length }, 'Crawl complete');

  return result;
}
