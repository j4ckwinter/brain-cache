import pino from 'pino';

const VALID_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
type LogLevel = typeof VALID_LEVELS[number];

function resolveLevel(): LogLevel {
  const env = process.env.BRAIN_CACHE_LOG?.toLowerCase();
  if (VALID_LEVELS.includes(env as LogLevel)) return env as LogLevel;
  return 'warn';
}

export const logger = pino(
  {
    level: resolveLevel(),
    redact: {
      paths: [
        'apiKey',
        'api_key',
        'secret',
        'password',
        'token',
        'authorization',
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        '*.apiKey',
        '*.api_key',
        '*.secret',
        '*.password',
        '*.token',
        '*.authorization',
        '*.ANTHROPIC_API_KEY',
        '*.OPENAI_API_KEY',
      ],
      censor: '[Redacted]',
    },
  },
  pino.destination(2) // stderr, always — per D-16
);

export function childLogger(component: string) {
  return logger.child({ component });
}

/**
 * Set the pino logger level at runtime.
 * Use 'silent' to suppress all output during CLI workflows that write their own output.
 */
export function setLogLevel(level: LogLevel): void {
  logger.level = level;
}
