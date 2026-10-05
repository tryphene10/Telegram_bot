import { describe, expect, it } from 'vitest';
import {
  InvalidStateTransitionError,
  MISSION_STATUSES,
  MISSION_TRANSITIONS,
  assertApprovalTransition,
  assertMissionTransition,
  assertToolExecutionTransition,
} from './states.js';

describe('state transitions', () => {
  it('accepts the nominal mission lifecycle', () => {
    expect(() => assertMissionTransition('CREATED', 'QUEUED')).not.toThrow();
    expect(() => assertMissionTransition('RUNNING', 'VERIFYING')).not.toThrow();
    expect(() => assertMissionTransition('VERIFYING', 'COMPLETED')).not.toThrow();
  });

  it('rejects terminal and skipped transitions deterministically', () => {
    expect(() => assertMissionTransition('COMPLETED', 'RUNNING')).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => assertMissionTransition('CREATED', 'COMPLETED')).toThrow(
      'Invalid mission transition: CREATED -> COMPLETED',
    );
  });

  it('makes approval decisions final', () => {
    expect(() => assertApprovalTransition('PENDING', 'APPROVED')).not.toThrow();
    expect(() => assertApprovalTransition('APPROVED', 'REJECTED')).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('requires authorization before execution', () => {
    expect(() => assertToolExecutionTransition('CREATED', 'RUNNING')).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => assertToolExecutionTransition('AUTHORIZED', 'RUNNING')).not.toThrow();
  });

  it('defines and enforces transitions for every mission state', () => {
    expect(Object.keys(MISSION_TRANSITIONS).sort()).toEqual([...MISSION_STATUSES].sort());
    for (const from of MISSION_STATUSES) {
      for (const to of MISSION_STATUSES) {
        if (MISSION_TRANSITIONS[from].includes(to)) {
          expect(() => assertMissionTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertMissionTransition(from, to)).toThrow(InvalidStateTransitionError);
        }
      }
    }
  });
});
