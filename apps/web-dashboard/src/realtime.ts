import type { RealtimeEventDto } from '@arcc/web-contracts';
export class RealtimeProjectionStore {
  private cursor = 0;
  private readonly seen = new Set<string>();
  accept(event: RealtimeEventDto): 'ACCEPTED' | 'DUPLICATE' | 'GAP' {
    if (this.seen.has(event.id) || event.sequence <= this.cursor) return 'DUPLICATE';
    if (event.sequence !== this.cursor + 1 && this.cursor !== 0) return 'GAP';
    this.seen.add(event.id);
    this.cursor = event.sequence;
    if (this.seen.size > 1000) this.seen.clear();
    return 'ACCEPTED';
  }
  currentCursor() {
    return this.cursor;
  }
  reset(cursor = 0) {
    this.cursor = cursor;
    this.seen.clear();
  }
}

type EventSourceLike = Pick<EventSource, 'addEventListener' | 'close'>;

export class RealtimeClient {
  private source: EventSourceLike | undefined;
  private readonly store = new RealtimeProjectionStore();

  constructor(
    private readonly onEvent: (event: RealtimeEventDto) => void,
    private readonly onResync: () => void,
    private readonly createSource: (url: string) => EventSourceLike = (url) => new EventSource(url),
  ) {}

  connect() {
    this.disconnect();
    const cursor = this.store.currentCursor();
    this.source = this.createSource(`/api/v1/events?cursor=${cursor}`);
    this.source.addEventListener('projection', (message) => {
      const data = 'data' in message ? String(message.data) : '';
      if (data.length > 65_536) {
        this.onResync();
        return;
      }
      try {
        const event = JSON.parse(data) as RealtimeEventDto;
        const result = this.store.accept(event);
        if (result === 'GAP') this.onResync();
        if (result === 'ACCEPTED') this.onEvent(event);
      } catch {
        this.onResync();
      }
    });
  }

  reset(cursor = 0) {
    this.store.reset(cursor);
    this.connect();
  }

  disconnect() {
    this.source?.close();
    this.source = undefined;
  }
}
