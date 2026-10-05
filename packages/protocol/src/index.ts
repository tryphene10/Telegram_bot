export const PROTOCOL_VERSION = '0.1.0' as const;

export const PROTOCOL_MESSAGE_KINDS = [
  'HELLO',
  'HEARTBEAT',
  'EXECUTE_TOOL',
  'TOOL_PROGRESS',
  'TOOL_RESULT',
  'CANCEL_TOOL',
  'TRANSFER_START',
  'TRANSFER_CHUNK',
  'TRANSFER_COMPLETE',
  'ACK',
] as const;
export type ProtocolMessageKind = (typeof PROTOCOL_MESSAGE_KINDS)[number];

export const MACHINE_STATUSES = ['ONLINE', 'OFFLINE', 'BUSY', 'MAINTENANCE', 'REVOKED'] as const;
export type MachineStatus = (typeof MACHINE_STATUSES)[number];

export interface ProtocolEnvelope {
  readonly version: typeof PROTOCOL_VERSION;
  readonly kind: ProtocolMessageKind;
  readonly messageId: string;
  readonly machineId: string;
  readonly sequence: number;
  readonly sentAt: string;
  readonly executionId?: string;
  readonly acknowledgement?: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface SignedProtocolEnvelope {
  readonly credentialId: string;
  readonly envelope: ProtocolEnvelope;
  readonly signature: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

export class ProtocolValidationError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid protocol message: ${reason}`);
    this.name = 'ProtocolValidationError';
  }
}

function requireString(payload: Record<string, unknown>, field: string): void {
  if (typeof payload[field] !== 'string' || (payload[field] as string).length === 0) {
    throw new ProtocolValidationError(`payload_${field}_required`);
  }
}

function validatePayload(
  kind: ProtocolMessageKind,
  payload: Record<string, unknown>,
  acknowledgement: unknown,
): void {
  switch (kind) {
    case 'HELLO':
      requireString(payload, 'nonce');
      if (
        !Number.isSafeInteger(payload.lastAcknowledgedSequence) ||
        (payload.lastAcknowledgedSequence as number) < 0 ||
        !isRecord(payload.capabilities)
      ) {
        throw new ProtocolValidationError('invalid_hello_payload');
      }
      break;
    case 'HEARTBEAT':
      if (!MACHINE_STATUSES.includes(payload.status as MachineStatus)) {
        throw new ProtocolValidationError('invalid_machine_status');
      }
      break;
    case 'EXECUTE_TOOL':
      requireString(payload, 'tool');
      requireString(payload, 'idempotencyKey');
      requireString(payload, 'authorizationId');
      if (!isRecord(payload.parameters)) {
        throw new ProtocolValidationError('invalid_tool_parameters');
      }
      break;
    case 'TOOL_PROGRESS':
      if (typeof payload.percent !== 'number' || payload.percent < 0 || payload.percent > 100) {
        throw new ProtocolValidationError('invalid_progress');
      }
      break;
    case 'TOOL_RESULT':
      if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(payload.status as string)) {
        throw new ProtocolValidationError('invalid_tool_result');
      }
      break;
    case 'CANCEL_TOOL':
      requireString(payload, 'reason');
      break;
    case 'TRANSFER_START':
      requireString(payload, 'transferId');
      requireString(payload, 'sha256');
      if (!Number.isSafeInteger(payload.sizeBytes) || (payload.sizeBytes as number) < 0) {
        throw new ProtocolValidationError('invalid_transfer_size');
      }
      break;
    case 'TRANSFER_CHUNK':
      requireString(payload, 'transferId');
      requireString(payload, 'dataBase64');
      if (!Number.isSafeInteger(payload.index) || (payload.index as number) < 0) {
        throw new ProtocolValidationError('invalid_chunk_index');
      }
      break;
    case 'TRANSFER_COMPLETE':
      requireString(payload, 'transferId');
      requireString(payload, 'sha256');
      break;
    case 'ACK':
      if (!Number.isSafeInteger(acknowledgement) || (acknowledgement as number) < 0) {
        throw new ProtocolValidationError('acknowledgement_required');
      }
      break;
  }
}

export function parseProtocolEnvelope(value: unknown): ProtocolEnvelope {
  if (!isRecord(value)) throw new ProtocolValidationError('envelope_not_object');
  if (value.version !== PROTOCOL_VERSION) throw new ProtocolValidationError('unsupported_version');
  if (!PROTOCOL_MESSAGE_KINDS.includes(value.kind as ProtocolMessageKind)) {
    throw new ProtocolValidationError('unknown_kind');
  }
  if (!isUuid(value.messageId) || !isUuid(value.machineId)) {
    throw new ProtocolValidationError('invalid_identifier');
  }
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) {
    throw new ProtocolValidationError('invalid_sequence');
  }
  if (typeof value.sentAt !== 'string' || Number.isNaN(Date.parse(value.sentAt))) {
    throw new ProtocolValidationError('invalid_timestamp');
  }
  if (!isRecord(value.payload)) throw new ProtocolValidationError('invalid_payload');
  if (value.executionId !== undefined && !isUuid(value.executionId)) {
    throw new ProtocolValidationError('invalid_execution_id');
  }
  if (
    value.acknowledgement !== undefined &&
    (!Number.isSafeInteger(value.acknowledgement) || (value.acknowledgement as number) < 0)
  ) {
    throw new ProtocolValidationError('invalid_acknowledgement');
  }
  if (
    ['EXECUTE_TOOL', 'TOOL_PROGRESS', 'TOOL_RESULT', 'CANCEL_TOOL'].includes(
      value.kind as string,
    ) &&
    !value.executionId
  ) {
    throw new ProtocolValidationError('execution_id_required');
  }
  validatePayload(value.kind as ProtocolMessageKind, value.payload, value.acknowledgement);
  return value as unknown as ProtocolEnvelope;
}

export function parseSignedEnvelope(value: unknown): SignedProtocolEnvelope {
  if (
    !isRecord(value) ||
    typeof value.credentialId !== 'string' ||
    typeof value.signature !== 'string'
  ) {
    throw new ProtocolValidationError('invalid_signature_wrapper');
  }
  return {
    credentialId: value.credentialId,
    signature: value.signature,
    envelope: parseProtocolEnvelope(value.envelope),
  };
}

export * from './signing.js';
export * from './machine-auth.js';
export * from './session.js';
