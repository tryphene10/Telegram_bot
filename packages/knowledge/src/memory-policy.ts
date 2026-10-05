import { SecretRedactor } from '@arcc/security';
import { sha256 } from './chunking.js';

export type MemoryScope = 'SESSION' | 'MISSION' | 'PROJECT' | 'USER_PREFERENCE';
export type MemoryKind = 'DECISION' | 'CONSTRAINT' | 'VERIFIED_RESULT' | 'RISK' | 'PREFERENCE';

const DEFAULT_TTL_MS: Readonly<Record<MemoryScope, number>> = {
  SESSION: 24 * 60 * 60_000,
  MISSION: 30 * 24 * 60 * 60_000,
  PROJECT: 180 * 24 * 60 * 60_000,
  USER_PREFERENCE: 365 * 24 * 60 * 60_000,
};

export interface MemoryPersistencePort {
  create(input: {
    readonly scope: MemoryScope;
    readonly kind: MemoryKind;
    readonly key: string;
    readonly value: string;
    readonly sha256: string;
    readonly version: number;
    readonly classification: 'LOCAL_ONLY';
    readonly expiresAt: string;
    readonly provenanceReference: string;
  }): Promise<string>;
  extend(entryId: string, expiresAt: string): Promise<void>;
}

export interface MemoryAuditPort {
  record(event: Readonly<Record<string, unknown>>): Promise<void>;
}

export class MemoryPolicyError extends Error {
  constructor(readonly reason: string) {
    super(`Memory policy rejected: ${reason}`);
    this.name = 'MemoryPolicyError';
  }
}

export class DurableMemoryService {
  constructor(
    private readonly persistence: MemoryPersistencePort,
    private readonly audit: MemoryAuditPort,
    private readonly redactor = new SecretRedactor(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async remember(input: {
    readonly scope: MemoryScope;
    readonly kind: MemoryKind;
    readonly key: string;
    readonly value: string;
    readonly version: number;
    readonly provenanceReference: string;
    readonly ttlMs?: number;
  }): Promise<string> {
    const value = input.value.trim();
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS[input.scope];
    if (
      !input.key.trim() ||
      !value ||
      value.length > 8_000 ||
      !Number.isSafeInteger(input.version) ||
      input.version < 1 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/\\-]{0,511}$/u.test(input.provenanceReference) ||
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 60_000 ||
      ttlMs > 2 * 365 * 24 * 60 * 60_000
    ) {
      throw new MemoryPolicyError('invalid_memory');
    }
    if (/^(?:prompt|raw_prompt|tool_output|artifact)$/iu.test(input.key)) {
      throw new MemoryPolicyError('excluded_content_kind');
    }
    if (this.redactor.redact(value).replacements > 0) {
      throw new MemoryPolicyError('secret_content_forbidden');
    }
    const id = await this.persistence.create({
      scope: input.scope,
      kind: input.kind,
      key: input.key,
      value,
      sha256: sha256(value),
      version: input.version,
      classification: 'LOCAL_ONLY',
      expiresAt: new Date(this.now().getTime() + ttlMs).toISOString(),
      provenanceReference: input.provenanceReference,
    });
    await this.audit.record({ operation: 'MEMORY_CREATED', entryId: id, scope: input.scope });
    return id;
  }

  async extend(entryId: string, ttlMs: number): Promise<void> {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 2 * 365 * 24 * 60 * 60_000) {
      throw new MemoryPolicyError('invalid_extension');
    }
    const expiresAt = new Date(this.now().getTime() + ttlMs).toISOString();
    await this.persistence.extend(entryId, expiresAt);
    await this.audit.record({ operation: 'MEMORY_EXPIRATION_EXTENDED', entryId, expiresAt });
  }
}
