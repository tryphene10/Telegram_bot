import { describe, expect, it, vi } from 'vitest';
import { RealtimeClient } from './realtime.js';

describe('RealtimeClient', () => {
  it('resumes from its cursor, deduplicates events and requests a resync on a gap', () => {
    const listeners = new Map<string, EventListener>();
    const close = vi.fn();
    const createSource = vi.fn(() => ({
      addEventListener: (name: string, listener: EventListenerOrEventListenerObject) =>
        listeners.set(name, listener as EventListener),
      close,
    }));
    const accepted = vi.fn();
    const resync = vi.fn();
    const client = new RealtimeClient(accepted, resync, createSource);

    client.connect();
    const emit = (id: string, sequence: number) =>
      listeners.get('projection')?.(
        new MessageEvent('projection', {
          data: JSON.stringify({
            version: 'v1',
            id,
            sequence,
            type: 'MISSION_UPDATED',
            projection: {},
          }),
        }),
      );
    emit('one', 1);
    emit('one', 1);
    emit('three', 3);

    expect(createSource).toHaveBeenCalledWith('/api/v1/events?cursor=0');
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(resync).toHaveBeenCalledTimes(1);
    client.disconnect();
    expect(close).toHaveBeenCalled();
  });
});
