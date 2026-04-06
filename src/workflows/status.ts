import { resolve } from 'node:path';
import { requireProfile } from '../lib/guards.js';
import { readIndexState } from '../services/lancedb.js';

/**
 * Reports index stats for a project directory.
 *
 * Reads the saved capability profile and index state, then prints
 * a formatted summary to stderr.
 *
 * Exits 1 if no profile or no index is found.
 * All output goes to stderr — zero stdout output (per D-16).
 */
export async function runStatus(targetPath?: string): Promise<void> {
  const rootDir = resolve(targetPath ?? '.');

  // Step 1: Read capability profile
  const profile = await requireProfile();

  // Step 2: Read index state
  const indexState = await readIndexState(rootDir);
  if (!indexState) {
    throw new Error(`No index found at ${rootDir}. Run 'brain-cache index [path]' first.`);
  }

  // Step 3: Print status report to stderr
  process.stderr.write(
    'brain-cache status\n' +
    '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
    `Path:              ${rootDir}\n` +
    `Files indexed:     ${indexState.fileCount}\n` +
    `Chunks stored:     ${indexState.chunkCount}\n` +
    `Last indexed:      ${indexState.indexedAt}\n` +
    `Embedding model:   ${indexState.embeddingModel}\n` +
    `Embedding dim:     ${indexState.dimension}\n` +
    `VRAM tier:         ${profile.vramTier}\n`
  );
}
