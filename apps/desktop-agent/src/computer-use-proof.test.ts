import { describe, expect, it } from 'vitest';
import { ComputerUseProofCollector, ComputerUseProofError } from './computer-use-proof.js';

const plan = {
  id: 'plan-1',
  revision: 2,
  hash: 'a'.repeat(64),
  requiredStepIds: ['step-1', 'step-2'],
} as const;

describe('ComputerUseProofCollector', () => {
  it('produces a verifiable digest with evidence, retries and interventions', () => {
    let tick = 0;
    const collector = new ComputerUseProofCollector(
      'mission-1',
      plan,
      () => new Date(`2026-10-01T00:00:0${tick++}.000Z`),
    );
    collector.recordVerifiedStep({
      stepId: 'step-1',
      criterion: 'application opened',
      evidenceReferences: ['audit:event-1'],
      annotatedArtifactReferences: ['artifact:screen-1'],
    });
    collector.recordVerifiedStep({
      stepId: 'step-2',
      criterion: 'value saved',
      evidenceReferences: ['audit:event-2'],
    });
    collector.recordExecution(3, 1);
    collector.recordIntervention({
      kind: 'TAKEOVER',
      checkpointId: 'checkpoint-1',
      startedAt: '2026-10-01T00:00:03.000Z',
      endedAt: '2026-10-01T00:00:04.000Z',
    });
    collector.recordRemainingRisk('REMOTE_SYNC_PENDING');

    const report = collector.finalize();
    expect(report).toMatchObject({
      status: 'VERIFIED',
      actions: 3,
      retries: 1,
      remainingRisks: ['REMOTE_SYNC_PENDING'],
    });
    expect(report.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(report)).toBe(true);
  });

  it('blocks completion when evidence is missing or an action result is unknown', () => {
    const collector = new ComputerUseProofCollector('mission-1', plan);
    collector.recordVerifiedStep({
      stepId: 'step-1',
      criterion: 'application opened',
      evidenceReferences: ['audit:event-1'],
    });
    collector.recordUnknownResult('action-9');
    expect(collector.finalize()).toMatchObject({
      status: 'BLOCKED',
      unknownResultActionIds: ['action-9'],
    });
  });

  it('only accepts opaque references and consistent counters', () => {
    const collector = new ComputerUseProofCollector('mission-1', plan);
    expect(() =>
      collector.recordVerifiedStep({
        stepId: 'step-1',
        criterion: 'verified',
        evidenceReferences: ['raw secret value'],
      }),
    ).toThrowError(ComputerUseProofError);
    expect(() => collector.recordExecution(1, 2)).toThrowError(ComputerUseProofError);
  });
});
