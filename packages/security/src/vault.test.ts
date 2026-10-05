import { describe, expect, it } from 'vitest';
import {
  LocalSecretVault,
  SecretNotFoundError,
  type KeyProtector,
  type PersistedVault,
  type VaultStore,
} from './vault.js';

class MemoryStore implements VaultStore {
  state: PersistedVault | null = null;

  async load(): Promise<PersistedVault | null> {
    return this.state ? structuredClone(this.state) : null;
  }

  async save(vault: PersistedVault): Promise<void> {
    this.state = structuredClone(vault);
  }
}

class TestProtector implements KeyProtector {
  async protect(key: Uint8Array): Promise<Uint8Array> {
    return Uint8Array.from(key, (byte) => byte ^ 0xa5);
  }

  async unprotect(key: Uint8Array): Promise<Uint8Array> {
    return Uint8Array.from(key, (byte) => byte ^ 0xa5);
  }
}

describe('LocalSecretVault', () => {
  it('persists only ciphertext and survives restart and key rotation', async () => {
    const store = new MemoryStore();
    const protector = new TestProtector();
    const vault = await LocalSecretVault.open(store, protector);
    await vault.set('telegram-bot-token', 'VAULT-CANARY-SECRET');

    expect(JSON.stringify(store.state)).not.toContain('VAULT-CANARY-SECRET');
    expect(vault.list()[0]).not.toHaveProperty('ciphertext');
    vault.close();

    const reopened = await LocalSecretVault.open(store, protector);
    expect(reopened.get('telegram-bot-token')).toBe('VAULT-CANARY-SECRET');
    await reopened.rotateKey();
    expect(reopened.get('telegram-bot-token')).toBe('VAULT-CANARY-SECRET');
    expect(reopened.list()[0]?.keyVersion).toBe(2);
  });

  it('revokes and removes a secret without exposing its value', async () => {
    const store = new MemoryStore();
    const vault = await LocalSecretVault.open(store, new TestProtector());
    await vault.set('provider-key', 'secret-value');
    await vault.revoke('provider-key');
    expect(() => vault.get('provider-key')).toThrow(SecretNotFoundError);
    await vault.remove('provider-key');
    expect(vault.list()).toHaveLength(0);
  });
});
