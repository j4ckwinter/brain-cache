import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { VRAMTier, CapabilityProfile, CapabilityProfileSchema } from '../lib/types.js';
import { GLOBAL_CONFIG_DIR, PROFILE_PATH } from '../lib/config.js';
import { childLogger } from './logger.js';

const execFileAsync = promisify(execFile);
const log = childLogger('capability');

/**
 * Detects NVIDIA GPU VRAM in GiB using nvidia-smi.
 * Returns null if nvidia-smi is not available or output cannot be parsed.
 */
export async function detectNvidiaVRAM(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=memory.total',
      '--format=csv,noheader,nounits',
    ], { timeout: 3000 });

    const raw = stdout.trim().split('\n')[0];
    const mib = parseInt(raw, 10);
    if (isNaN(mib)) {
      log.debug({ raw }, 'nvidia-smi returned non-numeric output');
      return null;
    }
    return Math.round(mib / 1024);
  } catch (err) {
    log.debug({ err }, 'nvidia-smi not available or timed out');
    return null;
  }
}

/**
 * Detects Apple Silicon unified memory in GiB using system_profiler.
 * Returns null on non-darwin platforms, Intel Macs, or any error.
 */
export async function detectAppleSiliconVRAM(): Promise<number | null> {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const { stdout } = await execFileAsync('system_profiler', [
      'SPHardwareDataType',
      '-json',
    ], { timeout: 3000 });

    const data = JSON.parse(stdout);
    const hwInfo = data.SPHardwareDataType?.[0];
    if (!hwInfo) return null;

    // Intel Macs: RAM is not VRAM — only return for Apple Silicon
    const chipType: string = hwInfo.chip_type ?? '';
    if (!chipType.includes('Apple M')) {
      log.debug({ chipType }, 'Non-Apple-Silicon Mac detected, skipping VRAM detection');
      return null;
    }

    const memoryStr: string = hwInfo.physical_memory ?? '';
    const match = memoryStr.match(/^(\d+)\s*GB/i);
    if (!match) {
      log.debug({ memoryStr }, 'Could not parse physical_memory from system_profiler');
      return null;
    }

    return parseInt(match[1], 10);
  } catch (err) {
    log.debug({ err }, 'system_profiler failed or returned invalid JSON');
    return null;
  }
}

/**
 * Classifies VRAM amount into a tier.
 * - null or < 2 GiB -> 'none'
 * - 2-7 GiB -> 'standard'
 * - 8+ GiB -> 'large'
 */
export function classifyVRAMTier(vramGiB: number | null): VRAMTier {
  if (vramGiB === null || vramGiB < 2) return 'none';
  if (vramGiB < 8) return 'standard';
  return 'large';
}

/**
 * Selects the appropriate embedding model for the given VRAM tier.
 */
export function selectEmbeddingModel(tier: VRAMTier): string {
  switch (tier) {
    case 'none':
    case 'standard':
      return 'nomic-embed-text';
    case 'large':
      return 'mxbai-embed-large';
  }
}

/**
 * Reads the capability profile from ~/.brain-cache/profile.json.
 * Returns null if the file does not exist, contains invalid JSON,
 * or fails schema validation.
 */
export async function readProfile(): Promise<CapabilityProfile | null> {
  try {
    const raw = await readFile(PROFILE_PATH, 'utf-8');
    const json = JSON.parse(raw);
    const result = CapabilityProfileSchema.safeParse(json);
    if (!result.success) {
      log.debug({ issues: result.error.issues }, 'Profile failed schema validation');
      return null;
    }
    return result.data;
  } catch (err) {
    log.debug({ err }, 'Could not read profile');
    return null;
  }
}

/**
 * Writes the capability profile to ~/.brain-cache/profile.json.
 * Creates the directory if it does not exist.
 */
export async function writeProfile(profile: CapabilityProfile): Promise<void> {
  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  await writeFile(PROFILE_PATH, JSON.stringify(profile, null, 2));
  log.debug({ path: PROFILE_PATH }, 'Profile written');
}

/**
 * Detects hardware capabilities and returns a CapabilityProfile.
 * Tries NVIDIA first, then Apple Silicon, falls back to no-GPU.
 */
export async function detectCapabilities(): Promise<CapabilityProfile> {
  let vramGiB: number | null = null;
  let gpuVendor: 'nvidia' | 'apple' | 'none' = 'none';

  const nvidiaVram = await detectNvidiaVRAM();
  if (nvidiaVram !== null) {
    vramGiB = nvidiaVram;
    gpuVendor = 'nvidia';
  } else {
    const appleVram = await detectAppleSiliconVRAM();
    if (appleVram !== null) {
      vramGiB = appleVram;
      gpuVendor = 'apple';
    }
  }

  const vramTier = classifyVRAMTier(vramGiB);
  const embeddingModel = selectEmbeddingModel(vramTier);

  log.info({ gpuVendor, vramGiB, vramTier, embeddingModel }, 'Hardware capabilities detected');

  return {
    version: 1,
    detectedAt: new Date().toISOString(),
    vramTier,
    vramGiB,
    gpuVendor,
    embeddingModel,
    ollamaVersion: null,
    platform: process.platform,
  };
}
