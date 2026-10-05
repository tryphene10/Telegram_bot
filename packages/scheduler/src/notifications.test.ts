import { describe, expect, it } from 'vitest';
import { decideAlert } from './notifications.js';
describe('alert grouping', () => {
  const state = {
    incidentId: 'i1',
    severity: 'ERROR' as const,
    lastSentAt: 1000,
    lastFingerprint: 'same',
    groupedCount: 0,
  };
  it('groups repeats but emits aggravations and distinct incidents', () => {
    expect(
      decideAlert({
        state,
        fingerprint: 'same',
        now: 1100,
        groupingWindowMs: 500,
        dailySent: 1,
        dailyBudget: 10,
      }).reason,
    ).toBe('GROUPED');
    expect(
      decideAlert({
        state,
        fingerprint: 'same',
        now: 1100,
        groupingWindowMs: 500,
        dailySent: 1,
        dailyBudget: 10,
        aggravated: true,
      }).send,
    ).toBe(true);
    expect(
      decideAlert({
        state,
        fingerprint: 'new',
        now: 1100,
        groupingWindowMs: 500,
        dailySent: 1,
        dailyBudget: 10,
      }).send,
    ).toBe(true);
  });
  it('never suppresses security because of budget', () => {
    expect(
      decideAlert({
        state: { ...state, severity: 'SECURITY' },
        fingerprint: 'same',
        now: 1100,
        groupingWindowMs: 500,
        dailySent: 10,
        dailyBudget: 10,
      }).reason,
    ).toBe('SECURITY');
  });
});
