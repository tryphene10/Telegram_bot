import { describe, expect, it, vi } from 'vitest';
import {
  PinAuthorizationService,
  hashPin,
  verifyPin,
  type PinChallenge,
  type PinChallengeStore,
} from './pin.js';

class MemoryChallenges implements PinChallengeStore {
  readonly values = new Map<string, PinChallenge>();
  async get(id: string) {
    return this.values.get(id) ?? null;
  }
  async save(challenge: PinChallenge) {
    this.values.set(challenge.id, challenge);
  }
}

describe('PIN security', () => {
  it('stores a slow salted derivation rather than the PIN', async () => {
    const encoded = await hashPin('123456');
    expect(encoded).not.toContain('123456');
    await expect(verifyPin('123456', encoded)).resolves.toBe(true);
    await expect(verifyPin('654321', encoded)).resolves.toBe(false);
  });

  it('authorizes only the exact action once', async () => {
    const store = new MemoryChallenges();
    const record = vi.fn();
    const service = new PinAuthorizationService(
      await hashPin('123456'),
      store,
      { record },
      () => 1_000,
    );
    const challenge = await service.create('git.commit:abc');
    await expect(service.authorize(challenge.id, 'git.push:abc', '123456')).rejects.toThrow(
      'action_mismatch',
    );
    await service.authorize(challenge.id, 'git.commit:abc', '123456');
    await expect(service.authorize(challenge.id, 'git.commit:abc', '123456')).rejects.toThrow(
      'unknown_or_replayed_challenge',
    );
  });

  it('expires and locks after five failures without auditing the PIN', async () => {
    const store = new MemoryChallenges();
    const record = vi.fn();
    const pinHash = await hashPin('123456');
    let now = 1_000;
    const service = new PinAuthorizationService(pinHash, store, { record }, () => now);
    const expiring = await service.create('action-expiring', 10);
    now = 1_011;
    await expect(service.authorize(expiring.id, 'action-expiring', '123456')).rejects.toThrow(
      'challenge_expired',
    );

    const locked = await service.create('action-locked');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.authorize(locked.id, 'action-locked', '000000')).rejects.toThrow();
    }
    expect(store.values.get(locked.id)?.status).toBe('LOCKED');
    expect(JSON.stringify(record.mock.calls)).not.toContain('000000');
    expect(JSON.stringify(record.mock.calls)).not.toContain('123456');
  });
});
