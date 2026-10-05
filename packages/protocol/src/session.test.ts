import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AuthenticatedProtocolSession,
  MachineConnectionState,
  PROTOCOL_VERSION,
  signEnvelope,
  type MachineIdentityRecord,
  type ProtocolEnvelope,
} from './index.js';

describe('protocol session', () => {
  const credential = randomBytes(32);
  const machine: MachineIdentityRecord = {
    machineId: randomUUID(),
    displayName: 'PC',
    status: 'ONLINE',
    credentialId: randomUUID(),
    credentialVersion: 1,
  };
  const message: ProtocolEnvelope = {
    version: PROTOCOL_VERSION,
    kind: 'HEARTBEAT',
    messageId: randomUUID(),
    machineId: machine.machineId,
    sequence: 1,
    sentAt: new Date(1_000).toISOString(),
    payload: { status: 'ONLINE' },
  };

  it('rejects repeated sequences and stale timestamps', () => {
    const session = new AuthenticatedProtocolSession(machine, credential, () => 1_000);
    const signed = signEnvelope(message, machine.credentialId, credential);
    expect(session.receive(signed)).toEqual(message);
    expect(() => session.receive(signed)).toThrow('sequence_replayed');
    const stale = {
      ...message,
      messageId: randomUUID(),
      sequence: 2,
      sentAt: new Date(0).toISOString(),
    };
    const strictSession = new AuthenticatedProtocolSession(machine, credential, () => 600_001);
    expect(() =>
      strictSession.receive(signEnvelope(stale, machine.credentialId, credential)),
    ).toThrow('timestamp_outside_window');
  });

  it('never accepts messages for a revoked machine', () => {
    const revoked = { ...machine, status: 'REVOKED' as const };
    const session = new AuthenticatedProtocolSession(revoked, credential, () => 1_000);
    expect(() => session.receive(signEnvelope(message, machine.credentialId, credential))).toThrow(
      'Machine is revoked',
    );
  });

  it('waits on disconnect and resumes only with the original authorization', () => {
    const state = new MachineConnectionState();
    state.connected();
    state.start('execution-1', 'authorization-1');
    state.disconnected();
    expect(state.snapshot()).toMatchObject({
      status: 'OFFLINE',
      executions: [{ status: 'WAITING_RECONNECT' }],
    });
    expect(() => state.resume('execution-1', 'other-authorization')).toThrow(
      'Execution resume is not authorized',
    );
    state.resume('execution-1', 'authorization-1');
    expect(state.snapshot().status).toBe('BUSY');
  });

  it('manages maintenance and revocation without implicit work', () => {
    const state = new MachineConnectionState();
    state.maintenance(true);
    expect(state.snapshot().status).toBe('MAINTENANCE');
    expect(() => state.start('execution-1', 'authorization-1')).toThrow(
      'Machine cannot start an execution',
    );
    state.maintenance(false);
    state.revoke();
    expect(() => state.connected()).toThrow('Machine is revoked');
    expect(state.snapshot().status).toBe('REVOKED');
  });
});
