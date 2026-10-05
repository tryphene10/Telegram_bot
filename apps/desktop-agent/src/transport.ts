export interface MachineSocket {
  readonly readyState: number;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: { data?: unknown }) => void,
  ): void;
  send(data: string): void;
  close(): void;
}

export interface MachineSocketFactory {
  create(url: string): MachineSocket;
}

export function validateMachineEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && loopback)) {
    throw new Error('Machine endpoint must use WSS or loopback WS');
  }
  return url;
}

export class GlobalMachineSocketFactory implements MachineSocketFactory {
  create(endpoint: string): MachineSocket {
    validateMachineEndpoint(endpoint);
    const constructor = (
      globalThis as unknown as {
        WebSocket?: new (url: string) => MachineSocket;
      }
    ).WebSocket;
    if (!constructor) throw new Error('WebSocket runtime is unavailable');
    return new constructor(endpoint);
  }
}

export interface MachineTransportLifecycle {
  connected(): void;
  disconnected(): void;
}

export class ReconnectingMachineTransport {
  constructor(
    private readonly endpoint: string,
    private readonly factory: MachineSocketFactory,
    private readonly lifecycle: MachineTransportLifecycle,
    private readonly hello: () => string,
    private readonly onMessage: (data: unknown) => Promise<void>,
    private readonly delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    validateMachineEndpoint(endpoint);
  }

  async run(signal: AbortSignal): Promise<void> {
    let backoffMs = 500;
    while (!signal.aborted) {
      try {
        await this.connectOnce(signal);
        backoffMs = 500;
      } catch {
        this.lifecycle.disconnected();
      }
      if (!signal.aborted) {
        await this.delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  }

  private connectOnce(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.factory.create(this.endpoint);
      let opened = false;
      signal.addEventListener('abort', () => socket.close(), { once: true });
      socket.addEventListener('open', () => {
        opened = true;
        this.lifecycle.connected();
        socket.send(this.hello());
      });
      socket.addEventListener('message', (event) => {
        void this.onMessage(event.data).catch(() => socket.close());
      });
      socket.addEventListener('close', () => {
        this.lifecycle.disconnected();
        resolve();
      });
      socket.addEventListener('error', () => {
        if (!opened) reject(new Error('Machine connection failed'));
        else socket.close();
      });
    });
  }
}
