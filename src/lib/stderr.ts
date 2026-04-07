// src/lib/stderr.ts
// Stack-based stderr filter utility.
// Installs a single shared interceptor at module load time.
// All filter coordination happens through filterStack — no repeated process.stderr.write assignments.

type FilterFn = (line: string) => boolean; // return true to suppress

/** Active filter stack. Last element is the innermost (most recently pushed) filter. */
const filterStack: FilterFn[] = [];

const originalWrite = process.stderr.write.bind(process.stderr);

// Install the single shared interceptor once at module load time.
// All filter coordination happens through filterStack, not by re-assigning process.stderr.write.
(process.stderr as NodeJS.WriteStream).write = ((
  chunk: string | Uint8Array,
  encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
  cb?: (err?: Error | null) => void,
): boolean => {
  const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf-8');
  // Apply filters in stack order (LIFO). If any filter suppresses, stop.
  for (let i = filterStack.length - 1; i >= 0; i--) {
    if (filterStack[i](str)) {
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
      callback?.(null);
      return true;
    }
  }
  // No filter suppressed — pass to original
  if (typeof encodingOrCb === 'function') {
    return originalWrite(chunk as string, encodingOrCb);
  }
  return originalWrite(chunk as string, encodingOrCb as BufferEncoding | undefined, cb);
}) as typeof process.stderr.write;

/**
 * Runs `fn` with a stderr filter active. The filter is pushed onto the stack
 * before `fn` is called and popped in a finally block.
 *
 * @param filter - Return true to suppress the line, false to pass it through.
 * @param fn - Async operation to run with the filter active.
 */
export async function withStderrFilter<T>(filter: FilterFn, fn: () => Promise<T>): Promise<T> {
  filterStack.push(filter);
  try {
    return await fn();
  } finally {
    // Pop this specific filter (LIFO — it's always the last one we pushed)
    filterStack.pop();
  }
}

/**
 * Exported for test access only — do not use in production code.
 * Provides access to the original stderr write function before the interceptor.
 */
export { originalWrite as _originalStderrWrite };
