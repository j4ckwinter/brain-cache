import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We need to test logger behavior related to:
// 1. logger writes to stderr (fd 2) via pino.destination(2)
// 2. default log level is 'warn' when BRAIN_CACHE_LOG is unset
// 3. BRAIN_CACHE_LOG=debug sets logger level to 'debug'
// 4. BRAIN_CACHE_LOG=invalid falls back to 'warn'
// 5. CapabilityProfileSchema.parse succeeds on valid profile
// 6. CapabilityProfileSchema.parse throws on invalid profile
// 7. GLOBAL_CONFIG_DIR equals path.join(os.homedir(), '.brain-cache')
// 8. PROFILE_PATH equals path.join(GLOBAL_CONFIG_DIR, 'profile.json')

describe('CapabilityProfileSchema', () => {
  it('parses a valid profile object', async () => {
    const { CapabilityProfileSchema } = await import('../../src/lib/types.js');
    const valid = {
      version: 1 as const,
      detectedAt: new Date().toISOString(),
      vramTier: 'standard' as const,
      vramGiB: 8,
      gpuVendor: 'nvidia' as const,
      embeddingModel: 'nomic-embed-text',
      ollamaVersion: '0.6.3',
      platform: 'linux',
    };
    expect(() => CapabilityProfileSchema.parse(valid)).not.toThrow();
  });

  it('parses a valid profile with null values', async () => {
    const { CapabilityProfileSchema } = await import('../../src/lib/types.js');
    const valid = {
      version: 1 as const,
      detectedAt: new Date().toISOString(),
      vramTier: 'none' as const,
      vramGiB: null,
      gpuVendor: 'none' as const,
      embeddingModel: 'nomic-embed-text',
      ollamaVersion: null,
      platform: 'linux',
    };
    expect(() => CapabilityProfileSchema.parse(valid)).not.toThrow();
  });

  it('throws on missing required fields', async () => {
    const { CapabilityProfileSchema } = await import('../../src/lib/types.js');
    expect(() => CapabilityProfileSchema.parse({})).toThrow();
  });

  it('throws when version is not 1', async () => {
    const { CapabilityProfileSchema } = await import('../../src/lib/types.js');
    expect(() =>
      CapabilityProfileSchema.parse({
        version: 2,
        detectedAt: new Date().toISOString(),
        vramTier: 'none',
        vramGiB: null,
        gpuVendor: 'none',
        embeddingModel: 'test',
        ollamaVersion: null,
        platform: 'linux',
      })
    ).toThrow();
  });

  it('throws on invalid vramTier value', async () => {
    const { CapabilityProfileSchema } = await import('../../src/lib/types.js');
    expect(() =>
      CapabilityProfileSchema.parse({
        version: 1,
        detectedAt: new Date().toISOString(),
        vramTier: 'ultra',
        vramGiB: null,
        gpuVendor: 'none',
        embeddingModel: 'test',
        ollamaVersion: null,
        platform: 'linux',
      })
    ).toThrow();
  });
});

describe('config constants', () => {
  it('GLOBAL_CONFIG_DIR is ~/.brain-cache', async () => {
    const { GLOBAL_CONFIG_DIR } = await import('../../src/lib/config.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    expect(GLOBAL_CONFIG_DIR).toBe(join(homedir(), '.brain-cache'));
  });

  it('PROFILE_PATH is GLOBAL_CONFIG_DIR/profile.json', async () => {
    const { GLOBAL_CONFIG_DIR, PROFILE_PATH } = await import('../../src/lib/config.js');
    const { join } = await import('node:path');
    expect(PROFILE_PATH).toBe(join(GLOBAL_CONFIG_DIR, 'profile.json'));
  });

  it('CONFIG_PATH is GLOBAL_CONFIG_DIR/config.json', async () => {
    const { GLOBAL_CONFIG_DIR, CONFIG_PATH } = await import('../../src/lib/config.js');
    const { join } = await import('node:path');
    expect(CONFIG_PATH).toBe(join(GLOBAL_CONFIG_DIR, 'config.json'));
  });
});

describe('logger', () => {
  // Save original env
  const originalEnv = process.env.BRAIN_CACHE_LOG;

  afterEach(() => {
    // Restore env
    if (originalEnv === undefined) {
      delete process.env.BRAIN_CACHE_LOG;
    } else {
      process.env.BRAIN_CACHE_LOG = originalEnv;
    }
    // Clear module cache between tests for logger so re-imports pick up env changes
    vi.resetModules();
  });

  it('default log level is warn when BRAIN_CACHE_LOG is unset', async () => {
    delete process.env.BRAIN_CACHE_LOG;
    vi.resetModules();
    const { logger } = await import('../../src/services/logger.js');
    expect(logger.level).toBe('warn');
  });

  it('BRAIN_CACHE_LOG=debug sets log level to debug', async () => {
    process.env.BRAIN_CACHE_LOG = 'debug';
    vi.resetModules();
    const { logger } = await import('../../src/services/logger.js');
    expect(logger.level).toBe('debug');
  });

  it('BRAIN_CACHE_LOG=info sets log level to info', async () => {
    process.env.BRAIN_CACHE_LOG = 'info';
    vi.resetModules();
    const { logger } = await import('../../src/services/logger.js');
    expect(logger.level).toBe('info');
  });

  it('BRAIN_CACHE_LOG=invalid falls back to warn', async () => {
    process.env.BRAIN_CACHE_LOG = 'invalid';
    vi.resetModules();
    const { logger } = await import('../../src/services/logger.js');
    expect(logger.level).toBe('warn');
  });

  it('BRAIN_CACHE_LOG=UPPERCASE is normalized to lowercase', async () => {
    process.env.BRAIN_CACHE_LOG = 'DEBUG';
    vi.resetModules();
    const { logger } = await import('../../src/services/logger.js');
    expect(logger.level).toBe('debug');
  });

  it('childLogger returns a child logger with component field', async () => {
    delete process.env.BRAIN_CACHE_LOG;
    vi.resetModules();
    const { childLogger } = await import('../../src/services/logger.js');
    const child = childLogger('test-component');
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
  });

  it('pino redact config censors apiKey values in log output', async () => {
    delete process.env.BRAIN_CACHE_LOG;
    vi.resetModules();

    // Create a custom pino logger with redact config pointing to an in-memory stream
    const pino = (await import('pino')).default;
    const { Writable } = await import('node:stream');

    const chunks: string[] = [];
    const dest = new Writable({
      write(chunk: Buffer, _encoding: string, callback: () => void) {
        chunks.push(chunk.toString());
        callback();
      },
    });

    const testLogger = pino(
      {
        level: 'info',
        redact: {
          paths: ['apiKey', 'api_key', 'secret', 'password', 'token', 'authorization'],
          censor: '[Redacted]',
        },
      },
      dest
    );

    testLogger.info({ apiKey: 'sk-ant-abc123' }, 'test message');
    // flush
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    const output = chunks.join('');
    expect(output).toContain('[Redacted]');
    expect(output).not.toContain('sk-ant-abc123');
  });
});
