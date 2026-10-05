import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';

const PIN_PATTERN = /^\d{6}$/u;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

function derive(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(new Error('PIN derivation failed'));
      else resolve(key);
    });
  });
}

export async function hashPin(pin: string): Promise<string> {
  if (!PIN_PATTERN.test(pin)) throw new Error('PIN must contain exactly 6 digits');
  const salt = randomBytes(16);
  const hash = await derive(pin, salt);
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPin(pin: string, encoded: string): Promise<boolean> {
  if (!PIN_PATTERN.test(pin)) return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
  const actual = await derive(pin, salt);
  return timingSafeEqual(actual, expected);
}

export interface PinChallenge {
  readonly id: string;
  readonly actionId: string;
  readonly expiresAt: number;
  readonly remainingAttempts: number;
  readonly status: 'PENDING' | 'AUTHORIZED' | 'LOCKED' | 'EXPIRED' | 'CANCELLED';
}

export interface PinChallengeStore {
  get(id: string): Promise<PinChallenge | null>;
  save(challenge: PinChallenge): Promise<void>;
}

export interface PinAuditSink {
  record(event: {
    readonly challengeId: string;
    readonly actionId: string;
    readonly decision: 'AUTHORIZED' | 'DENIED' | 'LOCKED' | 'EXPIRED';
    readonly reason: string;
  }): Promise<void>;
}

export class PinAuthorizationError extends Error {
  constructor(readonly reason: string) {
    super(`PIN authorization denied: ${reason}`);
    this.name = 'PinAuthorizationError';
  }
}

export class PinAuthorizationService {
  constructor(
    private readonly pinHash: string,
    private readonly store: PinChallengeStore,
    private readonly audit: PinAuditSink,
    private readonly now: () => number = Date.now,
  ) {}

  async create(actionId: string, lifetimeMs = 2 * 60 * 1000): Promise<PinChallenge> {
    if (!actionId.trim()) throw new Error('Action identifier is required');
    const challenge: PinChallenge = {
      id: randomUUID(),
      actionId,
      expiresAt: this.now() + lifetimeMs,
      remainingAttempts: 5,
      status: 'PENDING',
    };
    await this.store.save(challenge);
    return challenge;
  }

  async authorize(challengeId: string, actionId: string, pin: string): Promise<void> {
    const challenge = await this.store.get(challengeId);
    if (!challenge || challenge.status !== 'PENDING') {
      return this.deny(challengeId, actionId, 'DENIED', 'unknown_or_replayed_challenge');
    }
    if (challenge.actionId !== actionId) {
      return this.deny(challenge.id, actionId, 'DENIED', 'action_mismatch');
    }
    if (challenge.expiresAt <= this.now()) {
      await this.store.save({ ...challenge, status: 'EXPIRED' });
      return this.deny(challenge.id, actionId, 'EXPIRED', 'challenge_expired');
    }
    if (!(await verifyPin(pin, this.pinHash))) {
      const remainingAttempts = challenge.remainingAttempts - 1;
      const status = remainingAttempts <= 0 ? 'LOCKED' : 'PENDING';
      await this.store.save({ ...challenge, remainingAttempts, status });
      return this.deny(
        challenge.id,
        actionId,
        status === 'LOCKED' ? 'LOCKED' : 'DENIED',
        status === 'LOCKED' ? 'attempt_limit_reached' : 'invalid_pin',
      );
    }
    await this.store.save({ ...challenge, status: 'AUTHORIZED' });
    await this.audit.record({
      challengeId: challenge.id,
      actionId,
      decision: 'AUTHORIZED',
      reason: 'pin_verified',
    });
  }

  private async deny(
    challengeId: string,
    actionId: string,
    decision: 'DENIED' | 'LOCKED' | 'EXPIRED',
    reason: string,
  ): Promise<never> {
    await this.audit.record({ challengeId, actionId, decision, reason });
    throw new PinAuthorizationError(reason);
  }
}
