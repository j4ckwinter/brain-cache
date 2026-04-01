import ollama from 'ollama';
import {
  readProfile,
  detectCapabilities,
} from '../services/capability.js';
import {
  isOllamaInstalled,
  isOllamaRunning,
  getOllamaVersion,
} from '../services/ollama.js';
import { PROFILE_PATH } from '../lib/config.js';

/**
 * Reports system health: saved profile, live hardware detection, and Ollama status.
 *
 * Reads the existing profile (if any) and re-detects capabilities.
 * Does NOT modify the saved profile.
 *
 * All output goes to stderr — zero stdout output (per D-16).
 */
export async function runDoctor(): Promise<void> {
  // Step 1: Read saved profile
  const saved = await readProfile();
  if (!saved) {
    process.stderr.write("No profile found. Run 'brain-cache init' first.\n");
    process.exit(1);
  }

  // Step 2: Re-detect capabilities (does not overwrite saved profile per D-02)
  const live = await detectCapabilities();

  // Step 3: Check Ollama status
  const installed = await isOllamaInstalled();
  const running = installed ? await isOllamaRunning() : false;
  const version = installed ? await getOllamaVersion() : null;

  // Step 4: Check model presence in Ollama
  let modelPresent = false;
  if (running) {
    const list = await ollama.list();
    modelPresent = list.models.some((m: { name: string }) =>
      m.name.startsWith(saved.embeddingModel)
    );
  }

  const vramGiBDisplay = (gib: number | null) => gib !== null ? `${gib} GiB` : 'N/A';

  // Step 5: Print health report to stderr
  process.stderr.write(
    'brain-cache doctor\n' +
    '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
    `Saved profile:     ${PROFILE_PATH}\n` +
    `GPU:               ${saved.gpuVendor} (${vramGiBDisplay(saved.vramGiB)})\n` +
    `VRAM tier:         ${saved.vramTier}\n` +
    `Embedding model:   ${saved.embeddingModel}\n` +
    `Platform:          ${saved.platform}\n` +
    `Detected at:       ${saved.detectedAt}\n` +
    '\n' +
    'Live detection:\n' +
    `GPU:               ${live.gpuVendor} (${vramGiBDisplay(live.vramGiB)})\n` +
    `VRAM tier:         ${live.vramTier}\n` +
    '\n' +
    'Ollama:\n' +
    `Installed:         ${installed ? 'yes' : 'no'}\n` +
    `Running:           ${running ? 'yes' : 'no'}\n` +
    `Version:           ${version ?? 'unknown'}\n` +
    `Model loaded:      ${modelPresent ? 'yes' : 'no'}\n` +
    (!modelPresent && running
      ? `\n  Fix: run 'brain-cache init' to pull the model, or:\n` +
        `       ollama pull ${saved.embeddingModel}\n`
      : '')
  );
}
