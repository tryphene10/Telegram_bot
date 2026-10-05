import { describe, expect, it } from 'vitest';
import { parseRuntimeEnvironment } from './environment.js';

describe('runtime environment', () => {
  it('uses safe local defaults', () => {
    expect(parseRuntimeEnvironment({})).toEqual({
      apiHost: '127.0.0.1',
      apiPort: 4000,
      logLevel: 'info',
    });
  });

  it('rejects a non-loopback API host', () => {
    expect(() => parseRuntimeEnvironment({ API_HOST: '0.0.0.0' })).toThrow(
      'API_HOST must be a loopback address',
    );
  });

  it('rejects invalid ports and log levels', () => {
    expect(() => parseRuntimeEnvironment({ API_PORT: '70000' })).toThrow('API_PORT');
    expect(() => parseRuntimeEnvironment({ LOG_LEVEL: 'verbose' })).toThrow('LOG_LEVEL');
  });
});
