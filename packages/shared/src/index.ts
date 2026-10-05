export interface ServiceHealth {
  readonly service: string;
  readonly status: 'ok' | 'degraded';
}

export function healthy(service: string): ServiceHealth {
  return { service, status: 'ok' };
}

export * from './environment.js';
