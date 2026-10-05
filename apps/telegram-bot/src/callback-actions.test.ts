import { describe, expect, it } from 'vitest';
import { CallbackActionCodec } from './callback-actions.js';

describe('CallbackActionCodec', () => {
  it('creates compact signed single-use callbacks', async () => {
    const used = new Set<string>();
    const codec = new CallbackActionCodec(
      Buffer.alloc(32, 7),
      {
        claim: async (id) => !used.has(id) && Boolean(used.add(id)),
      },
      () => 1_000,
    );
    const token = codec.issue('PUSH', 'mission1', 10 * 60_000, 'rev7');
    expect(Buffer.byteLength(token)).toBeLessThanOrEqual(64);
    await expect(codec.consume(token)).resolves.toEqual({
      action: 'PUSH',
      target: 'mission1',
      stateTag: 'rev7',
    });
    await expect(codec.consume(token)).rejects.toThrow('replayed_callback');
  });

  it('rejects tampering and expiration', async () => {
    let now = 1_000;
    const codec = new CallbackActionCodec(
      Buffer.alloc(32, 8),
      { claim: async () => true },
      () => now,
    );
    const token = codec.issue('DIFF', 'task1', 1_000);
    await expect(codec.consume(`${token.slice(0, -1)}x`)).rejects.toThrow('invalid_callback');
    now = 3_000;
    await expect(codec.consume(token)).rejects.toThrow('expired_callback');
  });

  it('binds the action, mission and state into the signature', async () => {
    const codec = new CallbackActionCodec(Buffer.alloc(32, 9), { claim: async () => true });
    const token = codec.issue('TAKEOVER', 'mission2', 60_000, 'run4');
    const parts = token.split('.');
    parts[5] = 'run5';
    await expect(codec.consume(parts.join('.'))).rejects.toThrow('invalid_callback');
  });
});
