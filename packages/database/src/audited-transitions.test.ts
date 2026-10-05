import { describe, expect, it, vi } from 'vitest';
import {
  AuditedStateTransitions,
  SqlTransitionAuditSink,
  type TransitionAuditSink,
} from './audited-transitions.js';
import type { SqlClient } from './sql.js';

describe('AuditedStateTransitions', () => {
  it('audits a rejected transition with sanitized structural data', async () => {
    const recordRejectedTransition = vi.fn().mockResolvedValue(undefined);
    const transitions = new AuditedStateTransitions({
      recordRejectedTransition,
    } as TransitionAuditSink);

    await expect(
      transitions.approval('approval-id', 'APPROVED', 'REJECTED', 'correlation-id'),
    ).rejects.toThrow('Invalid approval transition');
    expect(recordRejectedTransition).toHaveBeenCalledWith({
      entity: 'approval',
      entityPublicId: 'approval-id',
      from: 'APPROVED',
      to: 'REJECTED',
      correlationId: 'correlation-id',
    });
  });

  it('does not audit a valid transition as rejected', async () => {
    const recordRejectedTransition = vi.fn();
    const transitions = new AuditedStateTransitions({
      recordRejectedTransition,
    } as unknown as TransitionAuditSink);
    await transitions.toolExecution('execution-id', 'AUTHORIZED', 'RUNNING', 'correlation-id');
    expect(recordRejectedTransition).not.toHaveBeenCalled();
  });

  it('writes through the append-only SQL function', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const sink = new SqlTransitionAuditSink({ query } as SqlClient);
    await sink.recordRejectedTransition({
      entity: 'mission',
      entityPublicId: 'mission-id',
      from: 'CREATED',
      to: 'COMPLETED',
      correlationId: 'correlation-id',
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('append_audit_log'), [
      'correlation-id',
      'mission',
      'mission-id',
      'CREATED',
      'COMPLETED',
    ]);
  });
});
