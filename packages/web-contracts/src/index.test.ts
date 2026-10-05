import { describe, expect, it } from 'vitest';
import { boundedQuery, parseMutationRequest } from './index.js';
describe('dashboard contracts', () => {
  it('bounds pagination and allowlists sorting', () => {
    expect(boundedQuery(new URLSearchParams('limit=900&sort=name'))).toEqual({
      limit: 100,
      sort: 'name',
    });
    expect(() => boundedQuery(new URLSearchParams('sort=sql'))).toThrow('sort_not_allowed');
  });
  it('validates versioned mutation input without arbitrary fields', () => {
    expect(
      parseMutationRequest({ action: 'MISSION_PAUSE', targetId: 'm1', expectedState: 'RUNNING' }),
    ).toMatchObject({ action: 'MISSION_PAUSE' });
    expect(() => parseMutationRequest({ action: 'x' })).toThrow('invalid_mutation_request');
  });
});
