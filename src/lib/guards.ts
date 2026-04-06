import { readProfile } from '../services/capability.js';
import { isOllamaRunning } from '../services/ollama.js';
import type { CapabilityProfile } from './types.js';

/**
 * Reads the capability profile and throws if not found.
 * Callers can be confident the returned profile is non-null.
 */
export async function requireProfile(): Promise<CapabilityProfile> {
  const profile = await readProfile();
  if (profile === null) {
    throw new Error("No profile found. Run 'brain-cache init' first.");
  }
  return profile;
}

/**
 * Checks Ollama is running and throws if not.
 */
export async function requireOllama(): Promise<void> {
  const running = await isOllamaRunning();
  if (!running) {
    throw new Error("Ollama is not running. Start it with 'ollama serve' or run 'brain-cache init'.");
  }
}
