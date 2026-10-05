import { describe, expect, it } from 'vitest';
import { DEFAULT_RETENTION, validateRetentionPolicy } from './retention.js';

describe('retention policy', () => {
  it('uses conservative local defaults', () => {
    expect(DEFAULT_RETENTION).toEqual({
      terminalLogsDays: 30,
      screenshotsDays: 7,
      temporaryFilesHours: 24,
    });
  });

  it('rejects zero, negative and fractional durations', () => {
    expect(() => validateRetentionPolicy({ ...DEFAULT_RETENTION, screenshotsDays: 0 })).toThrow(
      'screenshotsDays must be a positive integer',
    );
    expect(() => validateRetentionPolicy({ ...DEFAULT_RETENTION, terminalLogsDays: 1.5 })).toThrow(
      'terminalLogsDays must be a positive integer',
    );
  });
});
