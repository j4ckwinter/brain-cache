import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Blocklist of sensitive system directories that must not be used as index paths.
 * Per D-03: resolve-then-blocklist approach.
 * Per D-04: blocklist covers sensitive dirs only, NOT /usr or /bin.
 */
export const SENSITIVE_DIRS: string[] = [
  '/etc',
  '/var',
  join(homedir(), '.ssh'),
  join(homedir(), '.aws'),
  join(homedir(), '.gnupg'),
  join(homedir(), '.config'),
];

/**
 * Validates that a path does not point to a sensitive system directory.
 * Resolves the path first to handle relative traversal (../../) attacks.
 * Per D-03: resolve-then-blocklist approach.
 * Per D-04: blocklist covers sensitive dirs only, NOT /usr or /bin.
 * @throws Error if path resolves to a sensitive directory or its subdirectory
 */
export function validateIndexPath(rawPath: string): void {
  const resolved = resolve(rawPath);
  // macOS stores user temp dirs under /var/folders — not the same threat model as /var/log, /var/db, etc.
  if (resolved === '/var/folders' || resolved.startsWith('/var/folders/')) {
    return;
  }
  for (const sensitive of SENSITIVE_DIRS) {
    if (resolved === sensitive || resolved.startsWith(sensitive + '/')) {
      throw new Error(
        `Path '${resolved}' points to a sensitive system directory. Access denied.`
      );
    }
  }
}
