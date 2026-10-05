import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

export interface SecretMetadata {
  readonly id: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly keyVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface EncryptedSecret extends SecretMetadata {
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
}

export interface PersistedVault {
  readonly formatVersion: 1;
  readonly keyVersion: number;
  readonly protectedKey: string;
  readonly secrets: readonly EncryptedSecret[];
}

export interface VaultStore {
  load(): Promise<PersistedVault | null>;
  save(vault: PersistedVault): Promise<void>;
}

export interface KeyProtector {
  protect(key: Uint8Array): Promise<Uint8Array>;
  unprotect(protectedKey: Uint8Array): Promise<Uint8Array>;
}

export class SecretNotFoundError extends Error {
  constructor(name: string) {
    super(`Secret not found or revoked: ${name}`);
    this.name = 'SecretNotFoundError';
  }
}

export class LocalSecretVault {
  private constructor(
    private readonly store: VaultStore,
    private readonly protector: KeyProtector,
    private state: PersistedVault,
    private key: Buffer,
  ) {}

  static async open(store: VaultStore, protector: KeyProtector): Promise<LocalSecretVault> {
    const persisted = await store.load();
    if (persisted) {
      const key = Buffer.from(
        await protector.unprotect(Buffer.from(persisted.protectedKey, 'base64')),
      );
      if (key.length !== 32) throw new Error('Vault key is invalid');
      return new LocalSecretVault(store, protector, persisted, key);
    }

    const key = randomBytes(32);
    const protectedKey = Buffer.from(await protector.protect(key)).toString('base64');
    const state: PersistedVault = {
      formatVersion: 1,
      keyVersion: 1,
      protectedKey,
      secrets: [],
    };
    await store.save(state);
    return new LocalSecretVault(store, protector, state, key);
  }

  list(): readonly SecretMetadata[] {
    return this.state.secrets.map(({ id, name, status, keyVersion, createdAt, updatedAt }) => ({
      id,
      name,
      status,
      keyVersion,
      createdAt,
      updatedAt,
    }));
  }

  async set(name: string, value: string): Promise<SecretMetadata> {
    if (!name.trim() || !value) throw new Error('Secret name and value are required');
    const existing = this.state.secrets.find((secret) => secret.name === name);
    const now = new Date().toISOString();
    const encrypted = this.encrypt(
      {
        id: existing?.id ?? randomUUID(),
        name,
        status: 'ACTIVE',
        keyVersion: this.state.keyVersion,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
      value,
    );
    this.state = {
      ...this.state,
      secrets: [...this.state.secrets.filter((secret) => secret.name !== name), encrypted],
    };
    await this.store.save(this.state);
    return this.metadata(encrypted);
  }

  get(name: string): string {
    const secret = this.state.secrets.find(
      (candidate) => candidate.name === name && candidate.status === 'ACTIVE',
    );
    if (!secret) throw new SecretNotFoundError(name);
    return this.decrypt(secret, this.key);
  }

  async revoke(name: string): Promise<void> {
    const target = this.state.secrets.find(
      (candidate) => candidate.name === name && candidate.status === 'ACTIVE',
    );
    if (!target) throw new SecretNotFoundError(name);
    const now = new Date().toISOString();
    this.state = {
      ...this.state,
      secrets: this.state.secrets.map((secret) =>
        secret.name === name ? { ...secret, status: 'REVOKED', updatedAt: now } : secret,
      ),
    };
    await this.store.save(this.state);
  }

  async remove(name: string): Promise<void> {
    const next = this.state.secrets.filter((secret) => secret.name !== name);
    if (next.length === this.state.secrets.length) throw new SecretNotFoundError(name);
    this.state = { ...this.state, secrets: next };
    await this.store.save(this.state);
  }

  async rotateKey(): Promise<void> {
    const plaintext = this.state.secrets.map((secret) => ({
      metadata: this.metadata(secret),
      value: this.decrypt(secret, this.key),
    }));
    const oldKey = this.key;
    const nextKey = randomBytes(32);
    const keyVersion = this.state.keyVersion + 1;
    const protectedKey = Buffer.from(await this.protector.protect(nextKey)).toString('base64');
    const secrets = plaintext.map(({ metadata, value }) =>
      this.encrypt(
        { ...metadata, keyVersion, updatedAt: new Date().toISOString() },
        value,
        nextKey,
      ),
    );
    const nextState: PersistedVault = {
      formatVersion: 1,
      keyVersion,
      protectedKey,
      secrets,
    };
    await this.store.save(nextState);
    this.state = nextState;
    this.key = nextKey;
    oldKey.fill(0);
  }

  close(): void {
    this.key.fill(0);
  }

  private encrypt(metadata: SecretMetadata, value: string, key = this.key): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(metadata.name, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
      ...metadata,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private decrypt(secret: EncryptedSecret, key: Buffer): string {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(secret.iv, 'base64'));
    decipher.setAAD(Buffer.from(secret.name, 'utf8'));
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private metadata(secret: EncryptedSecret): SecretMetadata {
    const { id, name, status, keyVersion, createdAt, updatedAt } = secret;
    return { id, name, status, keyVersion, createdAt, updatedAt };
  }
}
