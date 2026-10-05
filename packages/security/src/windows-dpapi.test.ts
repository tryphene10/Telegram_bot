import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WindowsDpapiKeyProtector } from './windows-dpapi.js';

describe('WindowsDpapiKeyProtector', () => {
  it.runIf(process.platform === 'win32')(
    'round-trips a key bound to the current Windows account',
    async () => {
      const protector = new WindowsDpapiKeyProtector();
      const key = randomBytes(32);
      const protectedKey = await protector.protect(key);
      expect(Buffer.from(protectedKey).equals(key)).toBe(false);
      const restored = await protector.unprotect(protectedKey);
      expect(Buffer.from(restored).equals(key)).toBe(true);
    },
    15_000,
  );
});
