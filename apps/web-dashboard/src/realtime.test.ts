import { describe, expect, it } from 'vitest';
import { RealtimeProjectionStore } from './realtime.js';
const event = (id: string, sequence: number) => ({
  version: 'v1' as const,
  id,
  sequence,
  type: 'MISSION_UPDATED',
  projection: { status: 'RUNNING' },
});
describe('realtime projections', () => {
  it('deduplicates, preserves order and detects gaps for resync', () => {
    const store = new RealtimeProjectionStore();
    expect(store.accept(event('a', 4))).toBe('ACCEPTED');
    expect(store.accept(event('a', 4))).toBe('DUPLICATE');
    expect(store.accept(event('c', 6))).toBe('GAP');
    expect(store.accept(event('b', 5))).toBe('ACCEPTED');
    expect(store.currentCursor()).toBe(5);
  });
});
