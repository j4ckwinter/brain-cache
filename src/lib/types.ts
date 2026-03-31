import { z } from 'zod';

export type VRAMTier = 'none' | 'standard' | 'large';

export const CapabilityProfileSchema = z.object({
  version:        z.literal(1),
  detectedAt:     z.string().datetime(),
  vramTier:       z.enum(['none', 'standard', 'large']),
  vramGiB:        z.number().nullable(),
  gpuVendor:      z.enum(['nvidia', 'apple', 'none']),
  embeddingModel: z.string(),
  ollamaVersion:  z.string().nullable(),
  platform:       z.string(),
});

export type CapabilityProfile = z.infer<typeof CapabilityProfileSchema>;
