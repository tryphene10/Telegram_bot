import { describe, expect, it } from 'vitest';
import {
  dueOccurrences,
  localEventOccurrence,
  nextOccurrence,
  ScheduleValidationError,
} from './time.js';
import type { ScheduleDefinition } from './types.js';

const base: ScheduleDefinition = {
  id: 's1',
  triggerType: 'INTERVAL',
  expression: 'PT15M',
  timezone: 'Africa/Douala',
  catchUpPolicy: 'BOUNDED',
  catchUpLimit: 2,
  nextRunAt: '2026-01-01T00:00:00.000Z',
};

describe('schedule time calculator', () => {
  it('calculates intervals, bounded catch-up and latest-only deterministically', () => {
    expect(nextOccurrence(base, new Date('2026-01-01T00:01:00Z'))?.toISOString()).toBe(
      '2026-01-01T00:15:00.000Z',
    );
    expect(
      dueOccurrences(base, new Date('2026-01-01T00:50:00Z')).map((item) => item.dueAt),
    ).toEqual(['2026-01-01T00:30:00.000Z', '2026-01-01T00:45:00.000Z']);
    expect(
      dueOccurrences({ ...base, catchUpPolicy: 'LATEST_ONLY' }, new Date('2026-01-01T00:50:00Z')),
    ).toHaveLength(1);
    expect(
      dueOccurrences({ ...base, catchUpPolicy: 'SKIP' }, new Date('2026-01-01T00:50:00Z')),
    ).toEqual([]);
  });

  it('uses IANA local time for cron and windows', () => {
    const cron = {
      ...base,
      triggerType: 'CRON' as const,
      expression: '0 8 * * *',
      nextRunAt: undefined,
    };
    expect(nextOccurrence(cron, new Date('2026-01-01T06:30:00Z'))?.toISOString()).toBe(
      '2026-01-01T07:00:00.000Z',
    );
    const windowed = { ...base, window: { start: '08:00', end: '09:00' } };
    expect(nextOccurrence(windowed, new Date('2026-01-01T07:02:00Z'))?.toISOString()).toBe(
      '2026-01-01T07:15:00.000Z',
    );
  });

  it('rejects overly frequent and ambiguous cron definitions', () => {
    expect(() =>
      nextOccurrence({ ...base, triggerType: 'CRON', expression: '*/5 * * * *' }, new Date()),
    ).toThrow(ScheduleValidationError);
    expect(() =>
      nextOccurrence({ ...base, triggerType: 'CRON', expression: '0 8 1 * 1' }, new Date()),
    ).toThrow('ambiguous_day_fields');
  });

  it('keys local events durably and ignores clock rollback duplicates', () => {
    const schedule = { ...base, triggerType: 'LOCAL_EVENT' as const, expression: 'git.changed' };
    expect(
      localEventOccurrence(schedule, 'git.changed', 'evt-42', new Date('2026-01-01T00:00:00Z'))
        ?.key,
    ).toBe('event:git.changed:evt-42');
    expect(localEventOccurrence(schedule, 'other', 'evt-42', new Date())).toBeUndefined();
  });
});
