import { describe, expect, it, vi } from 'vitest';
import {
  LocalOwnerPairing,
  TelegramAccessController,
  TelegramSessionRegistry,
  type OwnerAccount,
  type OwnerAccountStore,
  type ReplayStore,
} from './access-control.js';

class OwnerMemory implements OwnerAccountStore {
  value: OwnerAccount | null = null;
  async load() {
    return this.value;
  }
  async save(owner: OwnerAccount) {
    this.value = owner;
  }
}

class ReplayMemory implements ReplayStore {
  readonly identifiers = new Set<string>();
  async claim(identifier: string) {
    if (this.identifiers.has(identifier)) return false;
    this.identifiers.add(identifier);
    return true;
  }
}

describe('Telegram access control', () => {
  it('pairs exactly one owner through a local one-time code', async () => {
    const owners = new OwnerMemory();
    const pairing = new LocalOwnerPairing(owners, () => 1_000);
    const code = await pairing.begin();
    await expect(pairing.claim({ userId: 1, chatId: 2 }, 'wrong')).rejects.toThrow(
      'Pairing denied',
    );
    await pairing.claim({ userId: 1, chatId: 2 }, code);
    expect(owners.value).toEqual({ userId: 1, chatId: 2, status: 'ACTIVE' });
    await expect(pairing.claim({ userId: 3, chatId: 4 }, code)).rejects.toThrow('Pairing denied');
  });

  it('denies unknown identities and replayed messages or callbacks', async () => {
    const owners = new OwnerMemory();
    owners.value = { userId: 1, chatId: 2, status: 'ACTIVE' };
    const replay = new ReplayMemory();
    const record = vi.fn();
    const access = new TelegramAccessController(owners, replay, { record }, () => 1_000);
    await expect(access.authorize({ userId: 9, chatId: 2 }, 10)).rejects.toThrow(
      'Telegram access denied',
    );
    await access.authorize({ userId: 1, chatId: 2 }, 10, 'callback-1');
    await expect(access.authorize({ userId: 1, chatId: 2 }, 11, 'callback-1')).rejects.toThrow(
      'Telegram event replayed',
    );
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('expires and revokes short sessions', () => {
    let now = 1_000;
    const sessions = new TelegramSessionRegistry(() => now);
    sessions.issue(1, 10);
    expect(sessions.isActive(1)).toBe(true);
    now = 1_011;
    expect(sessions.isActive(1)).toBe(false);
    sessions.issue(1);
    sessions.revoke(1);
    expect(sessions.isActive(1)).toBe(false);
  });
});
