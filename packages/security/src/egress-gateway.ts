import type { ClassifiedContent, DataClassification } from './classification.js';
import { SecretRedactor } from './redaction.js';

export const EGRESS_DESTINATIONS = [
  'LOCAL_MODEL',
  'OPENAI',
  'ANTHROPIC',
  'DEEPSEEK',
  'MOONSHOT',
] as const;
export type EgressDestination = (typeof EGRESS_DESTINATIONS)[number];

export interface EgressRequest {
  readonly destination: EgressDestination;
  readonly model: string;
  readonly correlationId: string;
  readonly payload: ClassifiedContent;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

export interface EgressResponse {
  readonly body: string;
  readonly returnedModel?: string | undefined;
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
}

export interface EgressDispatcher {
  dispatch(
    request: EgressRequest & { readonly payload: ClassifiedContent },
  ): Promise<EgressResponse>;
}

export interface EgressAuditEvent {
  readonly destination: EgressDestination;
  readonly model: string;
  readonly classification: DataClassification;
  readonly contentBytes: number;
  readonly decision: 'ALLOWED' | 'DENIED';
  readonly reason: string;
  readonly correlationId: string;
}

export interface EgressAuditSink {
  record(event: EgressAuditEvent): Promise<void>;
}

export class EgressDeniedError extends Error {
  constructor(readonly reason: string) {
    super(`Egress denied: ${reason}`);
    this.name = 'EgressDeniedError';
  }
}

export class EgressGateway {
  private readonly allowedDestinations: ReadonlySet<EgressDestination>;

  constructor(
    allowedDestinations: readonly EgressDestination[],
    private readonly dispatcher: EgressDispatcher,
    private readonly audit: EgressAuditSink,
    private readonly redactor = new SecretRedactor(),
  ) {
    this.allowedDestinations = new Set(allowedDestinations);
  }

  async send(request: EgressRequest): Promise<EgressResponse> {
    const redacted = this.redactor.redact(request.payload.content);
    const reason = this.denialReason(request, redacted.replacements);
    const auditEvent: EgressAuditEvent = {
      destination: request.destination,
      model: request.model,
      classification: request.payload.classification,
      contentBytes: Buffer.byteLength(request.payload.content, 'utf8'),
      decision: reason ? 'DENIED' : 'ALLOWED',
      reason: reason ?? 'policy_allowed',
      correlationId: request.correlationId,
    };
    await this.audit.record(auditEvent);
    if (reason) {
      throw new EgressDeniedError(reason);
    }

    return this.dispatcher.dispatch({
      ...request,
      payload: { ...request.payload, content: redacted.text },
    });
  }

  private denialReason(request: EgressRequest, secretMatches: number): string | null {
    if (!this.allowedDestinations.has(request.destination)) return 'destination_not_allowlisted';
    if (request.model.trim().length === 0) return 'explicit_model_required';
    if (request.payload.classification === 'SECRET' || secretMatches > 0) {
      return 'secret_content_forbidden';
    }
    if (
      request.destination !== 'LOCAL_MODEL' &&
      request.payload.classification !== 'PUBLIC' &&
      request.payload.classification !== 'CLOUD_SAFE'
    ) {
      return 'classification_forbids_cloud';
    }
    return null;
  }
}
