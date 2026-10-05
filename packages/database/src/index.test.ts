import { describe, expect, it } from 'vitest';
import { DATABASE_BOUNDARY } from './index.js';

describe('database boundary', () => {
  it('keeps durable state outside the queue', () => {
    expect(DATABASE_BOUNDARY.queueStateIsAuthoritative).toBe(false);
  });
});
