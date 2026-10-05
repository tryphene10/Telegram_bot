export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface RuntimeEnvironment {
  readonly apiHost: '127.0.0.1' | 'localhost' | '::1';
  readonly apiPort: number;
  readonly logLevel: LogLevel;
}

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const;

export function parseRuntimeEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): RuntimeEnvironment {
  const apiHost = source.API_HOST?.trim() || '127.0.0.1';
  if (!LOOPBACK_HOSTS.includes(apiHost as RuntimeEnvironment['apiHost'])) {
    throw new Error('API_HOST must be a loopback address');
  }

  const apiPort = Number(source.API_PORT ?? '4000');
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65_535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }

  const logLevel = source.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(logLevel as LogLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }

  return {
    apiHost: apiHost as RuntimeEnvironment['apiHost'],
    apiPort,
    logLevel: logLevel as LogLevel,
  };
}
