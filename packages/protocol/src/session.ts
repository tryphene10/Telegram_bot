import type { MachineIdentityRecord } from './machine-auth.js';
import { verifySignedEnvelope } from './signing.js';
import type { ProtocolEnvelope } from './index.js';

export class ProtocolReplayError extends Error {
  constructor(readonly reason: string) {
    super(`Protocol message denied: ${reason}`);
    this.name = 'ProtocolReplayError';
  }
}

export class AuthenticatedProtocolSession {
  private lastSequence = 0;

  constructor(
    private readonly machine: MachineIdentityRecord,
    private readonly credential: Uint8Array,
    private readonly now: () => number = Date.now,
    private readonly maximumClockSkewMs = 5 * 60 * 1000,
  ) {}

  receive(value: unknown): ProtocolEnvelope {
    if (this.machine.status === 'REVOKED') throw new Error('Machine is revoked');
    const signed = verifySignedEnvelope(value, this.machine.credentialId, this.credential);
    const envelope = signed.envelope;
    if (envelope.machineId !== this.machine.machineId) {
      throw new Error('Protocol authentication failed');
    }
    if (Math.abs(this.now() - Date.parse(envelope.sentAt)) > this.maximumClockSkewMs) {
      throw new ProtocolReplayError('timestamp_outside_window');
    }
    if (envelope.sequence <= this.lastSequence) {
      throw new ProtocolReplayError('sequence_replayed');
    }
    this.lastSequence = envelope.sequence;
    return envelope;
  }

  checkpoint(): number {
    return this.lastSequence;
  }

  restore(lastAcknowledgedSequence: number): void {
    if (
      !Number.isSafeInteger(lastAcknowledgedSequence) ||
      lastAcknowledgedSequence < this.lastSequence
    ) {
      throw new Error('Invalid session checkpoint');
    }
    this.lastSequence = lastAcknowledgedSequence;
  }
}

export type InterruptedExecutionStatus = 'RUNNING' | 'WAITING_RECONNECT' | 'CANCELLED';

export interface InterruptedExecution {
  readonly executionId: string;
  readonly authorizationId: string;
  readonly status: InterruptedExecutionStatus;
}

export class MachineConnectionState {
  private status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE' | 'REVOKED' = 'OFFLINE';
  private readonly executions = new Map<string, InterruptedExecution>();

  connected(): void {
    if (this.status === 'REVOKED') throw new Error('Machine is revoked');
    this.status = this.executions.size > 0 ? 'BUSY' : 'ONLINE';
  }

  disconnected(): void {
    this.status = 'OFFLINE';
    for (const [id, execution] of this.executions) {
      if (execution.status === 'RUNNING') {
        this.executions.set(id, { ...execution, status: 'WAITING_RECONNECT' });
      }
    }
  }

  start(executionId: string, authorizationId: string): void {
    if (this.status === 'MAINTENANCE' || this.status === 'REVOKED') {
      throw new Error('Machine cannot start an execution');
    }
    this.executions.set(executionId, { executionId, authorizationId, status: 'RUNNING' });
    this.status = 'BUSY';
  }

  maintenance(enabled: boolean): void {
    if (this.status === 'REVOKED') throw new Error('Machine is revoked');
    if (this.executions.size > 0) throw new Error('Busy machine cannot enter maintenance');
    this.status = enabled ? 'MAINTENANCE' : 'OFFLINE';
  }

  revoke(): void {
    this.status = 'REVOKED';
    for (const [id, execution] of this.executions) {
      this.executions.set(id, { ...execution, status: 'CANCELLED' });
    }
  }

  resume(executionId: string, authorizationId: string): void {
    const execution = this.executions.get(executionId);
    if (
      !execution ||
      execution.status !== 'WAITING_RECONNECT' ||
      execution.authorizationId !== authorizationId
    ) {
      throw new Error('Execution resume is not authorized');
    }
    this.executions.set(executionId, { ...execution, status: 'RUNNING' });
    this.status = 'BUSY';
  }

  snapshot() {
    return { status: this.status, executions: [...this.executions.values()] } as const;
  }
}
