import { resolve, join, parse, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';

/**
 * Blocklist of sensitive system directories that must not be used as index paths.
 * Per D-03: resolve-then-blocklist approach.
 * Per D-04: blocklist covers sensitive dirs only, NOT /usr or /bin.
 */
export const SENSITIVE_DIRS: string[] = [
  ...(process.platform === 'win32'
    ? [process.env.SystemRoot, process.env.ProgramData].filter((value): value is string => Boolean(value))
    : ['/etc', '/var']),
  join(homedir(), '.ssh'),
  join(homedir(), '.aws'),
  join(homedir(), '.gnupg'),
  join(homedir(), '.config'),
];

// Default Windows and macOS filesystems ignore case, so `c:\users\me` and `/Users/ME` name the home directory.
const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';

function comparable(path: string): string {
  return caseInsensitive ? path.toLowerCase() : path;
}

function relativeTo(parent: string, candidate: string): string {
  return relative(comparable(resolve(parent)), comparable(candidate));
}

function isSameOrChild(candidate: string, parent: string): boolean {
  const rel = relativeTo(parent, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function rejectWindowsAliases(resolved: string): void {
  // `\\?\` and `\\.\` paths reach drives and devices but do not compare equal to their drive-letter forms.
  if (/^\\\\[?.]\\/.test(resolved)) {
    throw new Error(`Path '${resolved}' uses a Windows namespace prefix. Access denied.`);
  }
  // Shares such as `\\localhost\C$` and `\\host\ADMIN$` expose whole drives and the Windows directory.
  // Other hidden shares (`\\server\users$`) are ordinary project locations.
  if (/^\\\\[^\\]+\\([a-z]|admin|ipc|print)\$(\\|$)/i.test(resolved)) {
    throw new Error(`Path '${resolved}' is an administrative share. Access denied.`);
  }
}

/**
 * Validates that a path does not point to a sensitive system directory.
 * Resolves the path first to handle relative traversal (../../) attacks.
 * Per D-03: resolve-then-blocklist approach.
 * Per D-04: blocklist covers sensitive dirs only, NOT /usr or /bin.
 * @throws Error if path resolves to filesystem root, home directory root,
 *   a sensitive system directory, or its subdirectory
 */
export function validateIndexPath(rawPath: string): void {
  const resolved = resolve(rawPath);
  validateResolvedPath(resolved);
  // Junctions and symlinks (including Windows' built-in `C:\Documents and Settings`) reach protected
  // directories under other names. UNC paths are skipped because resolving them can block on the network.
  if (resolved.startsWith('\\\\')) return;
  let real: string;
  try {
    real = realpathSync.native(resolved);
  } catch {
    return;
  }
  if (comparable(real) !== comparable(resolved)) validateResolvedPath(real);
}

function validateResolvedPath(resolved: string): void {
  if (process.platform === 'win32') rejectWindowsAliases(resolved);
  // Reject filesystem root — never a valid project path
  if (resolved === parse(resolved).root) {
    throw new Error(
      `Path '${resolved}' is the filesystem root. Access denied.`
    );
  }
  // Reject home directory root — prevents accidental wipe of entire home dir
  const home = homedir();
  if (relativeTo(home, resolved) === '') {
    throw new Error(
      `Path '${resolved}' is the home directory root. Access denied.`
    );
  }
  // macOS stores user temp dirs under /var/folders — not the same threat model as /var/log, /var/db, etc.
  if (process.platform === 'darwin' && isSameOrChild(resolved, '/var/folders')) {
    return;
  }

  for (const sensitive of SENSITIVE_DIRS) {
    if (isSameOrChild(resolved, sensitive)) {
      throw new Error(
        `Path '${resolved}' points to a sensitive system directory. Access denied.`
      );
    }
  }
}
