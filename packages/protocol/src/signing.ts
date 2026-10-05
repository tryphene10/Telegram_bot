import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  parseSignedEnvelope,
  type ProtocolEnvelope,
  type SignedProtocolEnvelope,
} from './index.js';

function canonicalEnvelope(envelope: ProtocolEnvelope): string {
  return JSON.stringify({
    version: envelope.version,
    kind: envelope.kind,
    messageId: envelope.messageId,
    machineId: envelope.machineId,
    sequence: envelope.sequence,
    sentAt: envelope.sentAt,
    executionId: envelope.executionId ?? null,
    acknowledgement: envelope.acknowledgement ?? null,
    payload: envelope.payload,
  });
}

export function signEnvelope(
  envelope: ProtocolEnvelope,
  credentialId: string,
  credential: Uint8Array,
): SignedProtocolEnvelope {
  const signature = createHmac('sha256', credential)
    .update(canonicalEnvelope(envelope), 'utf8')
    .digest('base64');
  return { credentialId, envelope, signature };
}

export function verifySignedEnvelope(
  value: unknown,
  expectedCredentialId: string,
  credential: Uint8Array,
): SignedProtocolEnvelope {
  const signed = parseSignedEnvelope(value);
  if (signed.credentialId !== expectedCredentialId)
    throw new Error('Protocol authentication failed');
  const expected = signEnvelope(signed.envelope, signed.credentialId, credential).signature;
  const actualBytes = Buffer.from(signed.signature, 'base64');
  const expectedBytes = Buffer.from(expected, 'base64');
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error('Protocol authentication failed');
  }
  return signed;
}
