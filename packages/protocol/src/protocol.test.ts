import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  ProtocolValidationError,
  parseProtocolEnvelope,
  signEnvelope,
  verifySignedEnvelope,
  type ProtocolEnvelope,
} from './index.js';

function payloadFor(kind: ProtocolEnvelope['kind']): Readonly<Record<string, unknown>> {
  switch (kind) {
    case 'HELLO':
      return { nonce: 'nonce', lastAcknowledgedSequence: 0, capabilities: {} };
    case 'HEARTBEAT':
      return { status: 'ONLINE' };
    case 'EXECUTE_TOOL':
      return {
        tool: 'safe.tool',
        idempotencyKey: 'key',
        authorizationId: 'authorization',
        parameters: {},
      };
    case 'TOOL_PROGRESS':
      return { percent: 50 };
    case 'TOOL_RESULT':
      return { status: 'COMPLETED' };
    case 'CANCEL_TOOL':
      return { reason: 'requested' };
    case 'TRANSFER_START':
      return { transferId: 'transfer', sha256: 'hash', sizeBytes: 1 };
    case 'TRANSFER_CHUNK':
      return { transferId: 'transfer', dataBase64: 'YQ==', index: 0 };
    case 'TRANSFER_COMPLETE':
      return { transferId: 'transfer', sha256: 'hash' };
    case 'ACK':
      return {};
  }
}

function envelope(overrides: Partial<ProtocolEnvelope> = {}): ProtocolEnvelope {
  const kind = overrides.kind ?? 'HELLO';
  return {
    version: PROTOCOL_VERSION,
    kind,
    messageId: randomUUID(),
    machineId: randomUUID(),
    sequence: 1,
    sentAt: new Date().toISOString(),
    payload: payloadFor(kind),
    ...(kind === 'ACK' ? { acknowledgement: 0 } : {}),
    ...overrides,
  };
}

describe('machine protocol contract', () => {
  it('accepts every versioned message kind with valid common fields', () => {
    for (const kind of [
      'HELLO',
      'HEARTBEAT',
      'TRANSFER_START',
      'TRANSFER_CHUNK',
      'TRANSFER_COMPLETE',
      'ACK',
    ] as const) {
      expect(parseProtocolEnvelope(envelope({ kind })).kind).toBe(kind);
    }
    for (const kind of ['EXECUTE_TOOL', 'TOOL_PROGRESS', 'TOOL_RESULT', 'CANCEL_TOOL'] as const) {
      expect(parseProtocolEnvelope(envelope({ kind, executionId: randomUUID() })).kind).toBe(kind);
    }
  });

  it('fails closed on incompatible versions and missing execution ids', () => {
    expect(() => parseProtocolEnvelope({ ...envelope(), version: '99.0.0' })).toThrow(
      ProtocolValidationError,
    );
    expect(() => parseProtocolEnvelope(envelope({ kind: 'EXECUTE_TOOL' }))).toThrow(
      'execution_id_required',
    );
    expect(() =>
      parseProtocolEnvelope(envelope({ kind: 'HEARTBEAT', payload: { status: 'UNKNOWN' } })),
    ).toThrow('invalid_machine_status');
  });

  it('detects payload tampering and wrong credentials', () => {
    const credential = randomBytes(32);
    const signed = signEnvelope(envelope(), 'credential-1', credential);
    expect(verifySignedEnvelope(signed, 'credential-1', credential)).toEqual(signed);
    expect(() =>
      verifySignedEnvelope(
        { ...signed, envelope: { ...signed.envelope, sequence: 2 } },
        'credential-1',
        credential,
      ),
    ).toThrow('Protocol authentication failed');
    expect(() => verifySignedEnvelope(signed, 'credential-2', credential)).toThrow(
      'Protocol authentication failed',
    );
  });
});
