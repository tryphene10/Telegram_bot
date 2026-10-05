import { Buffer } from 'node:buffer';
import type { ContentKind, DataClassification } from '@arcc/security';
import { SecretRedactor } from '@arcc/security';

export function splitTelegramText(text: string, maximumBytes = 3_900): readonly string[] {
  if (maximumBytes < 64 || maximumBytes > 4_096) throw new Error('invalid_telegram_chunk_size');
  if (!text) return [''];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split(/(?<=\n)/u)) {
    for (const character of line) {
      const candidate = current + character;
      if (Buffer.byteLength(candidate, 'utf8') > maximumBytes) {
        if (current) chunks.push(current);
        current = character;
      } else current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface RetainedArtifact {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly expiresAt: number;
  readonly classification: DataClassification;
}

export interface ArtifactRetentionStore {
  save(artifact: RetainedArtifact): Promise<void>;
}

export class TelegramArtifactDelivery {
  private readonly redactor: SecretRedactor;
  constructor(
    private readonly retention: ArtifactRetentionStore,
    secretCanaries: readonly string[] = [],
    private readonly now: () => number = Date.now,
  ) {
    this.redactor = new SecretRedactor(secretCanaries);
  }

  text(input: {
    readonly kind: ContentKind;
    readonly classification: DataClassification;
    readonly content: string;
    readonly authorized: boolean;
  }): readonly string[] {
    this.authorize(input.classification, input.authorized);
    const redacted = this.redactor.redact(input.content).text;
    return splitTelegramText(`[${input.kind}]\n${redacted}`);
  }

  async attachment(input: {
    readonly id: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
    readonly classification: DataClassification;
    readonly authorized: boolean;
    readonly retentionMs: number;
  }): Promise<RetainedArtifact> {
    this.authorize(input.classification, input.authorized);
    if (input.bytes.byteLength > 49 * 1024 * 1024) throw new Error('telegram_attachment_too_large');
    if (input.retentionMs < 60_000 || input.retentionMs > 30 * 24 * 60 * 60_000)
      throw new Error('invalid_artifact_retention');
    const artifact: RetainedArtifact = {
      id: input.id,
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes: input.bytes,
      classification: input.classification,
      expiresAt: this.now() + input.retentionMs,
    };
    await this.retention.save(artifact);
    return artifact;
  }

  private authorize(classification: DataClassification, authorized: boolean): void {
    if (!authorized) throw new Error('telegram_artifact_not_authorized');
    if (classification === 'SECRET') throw new Error('secret_artifact_forbidden');
  }
}

export type NotificationPreference = 'SILENT' | 'NORMAL' | 'VERBOSE';
export type NotificationImportance = 'ROUTINE' | 'IMPORTANT' | 'SECURITY';

export class TelegramNotificationGate {
  private readonly sent = new Map<number, number[]>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly maximumPerMinute = 12,
  ) {}
  allow(
    userId: number,
    preference: NotificationPreference,
    importance: NotificationImportance,
  ): boolean {
    if (preference === 'SILENT' && importance !== 'SECURITY') return false;
    if (preference === 'NORMAL' && importance === 'ROUTINE') return false;
    const cutoff = this.now() - 60_000;
    const recent = (this.sent.get(userId) ?? []).filter((value) => value > cutoff);
    if (recent.length >= this.maximumPerMinute && importance !== 'SECURITY') return false;
    recent.push(this.now());
    this.sent.set(userId, recent);
    return true;
  }
}
