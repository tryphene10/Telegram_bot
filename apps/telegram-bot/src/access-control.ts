import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface TelegramIdentity {
  readonly userId: number;
  readonly chatId: number;
}

export interface OwnerAccount extends TelegramIdentity {
  readonly status: 'ACTIVE' | 'REVOKED';
}

export interface OwnerAccountStore {
  load(): Promise<OwnerAccount | null>;
  save(owner: OwnerAccount): Promise<void>;
}

export interface TelegramSecurityAudit {
  record(event: {
    readonly event: string;
    readonly userId?: number;
    readonly chatId?: number;
    readonly reason: string;
  }): Promise<void>;
}

export interface ReplayStore {
  claim(identifier: string, expiresAt: number): Promise<boolean>;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export class LocalOwnerPairing {
  private pendingDigest: Buffer | null = null;
  private expiresAt = 0;

  constructor(
    private readonly owners: OwnerAccountStore,
    private readonly now: () => number = Date.now,
  ) {}

  async begin(lifetimeMs = 5 * 60 * 1000): Promise<string> {
    if (await this.owners.load()) throw new Error('Owner is already paired');
    const code = randomBytes(6).toString('hex').toUpperCase();
    this.pendingDigest = digest(code);
    this.expiresAt = this.now() + lifetimeMs;
    return code;
  }

  async claim(identity: TelegramIdentity, code: string): Promise<OwnerAccount> {
    const supplied = digest(code.trim().toUpperCase());
    if (
      !this.pendingDigest ||
      this.expiresAt <= this.now() ||
      !timingSafeEqual(supplied, this.pendingDigest)
    ) {
      throw new Error('Pairing denied');
    }
    const owner: OwnerAccount = { ...identity, status: 'ACTIVE' };
    await this.owners.save(owner);
    this.pendingDigest.fill(0);
    this.pendingDigest = null;
    this.expiresAt = 0;
    return owner;
  }
}

export class TelegramAccessController {
  constructor(
    private readonly owners: OwnerAccountStore,
    private readonly replay: ReplayStore,
    private readonly audit: TelegramSecurityAudit,
    private readonly now: () => number = Date.now,
  ) {}

  async authorize(
    identity: TelegramIdentity,
    updateId: number,
    callbackId?: string,
  ): Promise<void> {
    const owner = await this.owners.load();
    if (
      !owner ||
      owner.status !== 'ACTIVE' ||
      owner.userId !== identity.userId ||
      owner.chatId !== identity.chatId
    ) {
      await this.audit.record({
        ...identity,
        event: 'telegram.access_denied',
        reason: 'unknown_identity',
      });
      throw new Error('Telegram access denied');
    }

    const identifiers = [`update:${updateId}`];
    if (callbackId) identifiers.push(`callback:${callbackId}`);
    for (const identifier of identifiers) {
      if (!(await this.replay.claim(identifier, this.now() + 24 * 60 * 60 * 1000))) {
        await this.audit.record({
          ...identity,
          event: 'telegram.replay_denied',
          reason: 'replayed_event',
        });
        throw new Error('Telegram event replayed');
      }
    }
  }
}

export class TelegramSessionRegistry {
  private readonly sessions = new Map<number, number>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(userId: number, lifetimeMs = 15 * 60 * 1000): void {
    this.sessions.set(userId, this.now() + lifetimeMs);
  }

  isActive(userId: number): boolean {
    const expiry = this.sessions.get(userId);
    if (!expiry || expiry <= this.now()) {
      this.sessions.delete(userId);
      return false;
    }
    return true;
  }

  revoke(userId: number): void {
    this.sessions.delete(userId);
  }
}
