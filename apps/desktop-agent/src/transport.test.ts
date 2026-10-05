import { describe, expect, it } from 'vitest';
import { validateMachineEndpoint } from './transport.js';

describe('machine transport endpoint', () => {
  it.each([
    'wss://command-center.example/machine',
    'ws://127.0.0.1:4000/machine',
    'ws://localhost:4000/machine',
  ])('accepts protected or loopback endpoint %s', (endpoint) => {
    expect(validateMachineEndpoint(endpoint).href).toBe(endpoint);
  });

  it.each(['ws://192.168.1.20/machine', 'http://127.0.0.1/machine'])(
    'rejects unprotected endpoint %s',
    (endpoint) => {
      expect(() => validateMachineEndpoint(endpoint)).toThrow(
        'Machine endpoint must use WSS or loopback WS',
      );
    },
  );
});
