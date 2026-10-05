import { describe, expect, it } from 'vitest';
import { SecretRedactor } from './redaction.js';

describe('SecretRedactor', () => {
  it('removes tokens, passwords, cookies, private keys and configured canaries', () => {
    const redactor = new SecretRedactor(['CANARY-SUPER-SECRET']);
    const input = [
      'Authorization: Bearer abc.def.ghi',
      'password=hunter2',
      'cookie=session-value',
      'CANARY-SUPER-SECRET',
      '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----',
    ].join('\n');
    const result = redactor.redact(input);
    expect(result.text).not.toContain('abc.def.ghi');
    expect(result.text).not.toContain('hunter2');
    expect(result.text).not.toContain('session-value');
    expect(result.text).not.toContain('CANARY-SUPER-SECRET');
    expect(result.text).not.toContain('private-material');
    expect(result.replacements).toBe(5);
  });
});
