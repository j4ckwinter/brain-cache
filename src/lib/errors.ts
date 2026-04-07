/**
 * Thrown when a workflow requires a brain-cache index but none exists at the
 * requested path. Caught by withGuards to trigger auto-index retry.
 */
export class NoIndexError extends Error {
  readonly rootDir: string;

  constructor(rootDir: string) {
    super(`No index found at ${rootDir}. Run 'brain-cache index' first.`);
    this.name = 'NoIndexError';
    this.rootDir = rootDir;
    // Maintain proper prototype chain in compiled JavaScript.
    // Required because TypeScript compiles class extends Error in a way that
    // can break instanceof checks without this explicit prototype fix.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
