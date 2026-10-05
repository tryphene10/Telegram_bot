import type { MonitorDefinition, MonitorProbePort, MonitorSample } from './monitoring.js';
export interface HttpMonitorPort {
  probe(
    url: string,
    timeoutMs: number,
  ): Promise<{ readonly statusCode: number; readonly latencyMs: number }>;
  authorize(url: URL): Promise<boolean>;
}
export interface WindowsMonitorPort {
  process(name: string): Promise<boolean>;
  service(name: string): Promise<boolean>;
  tcp(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<{ readonly available: boolean; readonly latencyMs: number }>;
}
export class MonitorTargetError extends Error {
  constructor(readonly reason: string) {
    super(`Monitor target rejected: ${reason}`);
    this.name = 'MonitorTargetError';
  }
}
function text(target: Readonly<Record<string, unknown>>, key: string): string {
  const value = target[key];
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,253}$/u.test(value))
    throw new MonitorTargetError(`invalid_${key}`);
  return value;
}
function ensureNoSensitiveFields(target: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(target))
    if (/token|secret|password|credential|body|header|cookie/iu.test(key))
      throw new MonitorTargetError('sensitive_target_field');
}
export class LocalMonitorProbeAdapter implements MonitorProbePort {
  constructor(
    private readonly http: HttpMonitorPort,
    private readonly windows: WindowsMonitorPort,
    private readonly timeoutMs = 5000,
  ) {}
  async sample(definition: MonitorDefinition): Promise<MonitorSample> {
    const started = Date.now();
    try {
      ensureNoSensitiveFields(definition.target);
      if (definition.type === 'HTTP') {
        const raw = definition.target.url;
        if (typeof raw !== 'string') throw new MonitorTargetError('invalid_url');
        const url = new URL(raw);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          !(await this.http.authorize(url))
        )
          throw new MonitorTargetError('http_target_not_allowed');
        const result = await this.http.probe(url.href, this.timeoutMs);
        return {
          available: result.statusCode >= 200 && result.statusCode < 500,
          statusCode: result.statusCode,
          latencyMs: result.latencyMs,
        };
      }
      if (definition.type === 'PROCESS')
        return {
          available: await this.windows.process(text(definition.target, 'name')),
          latencyMs: Date.now() - started,
        };
      if (definition.type === 'SERVICE')
        return {
          available: await this.windows.service(text(definition.target, 'name')),
          latencyMs: Date.now() - started,
        };
      const host = text(definition.target, 'host');
      const port = definition.target.port;
      if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535)
        throw new MonitorTargetError('invalid_port');
      return this.windows.tcp(host, Number(port), this.timeoutMs);
    } catch (error) {
      return {
        available: false,
        latencyMs: Date.now() - started,
        errorCode: error instanceof MonitorTargetError ? error.reason : 'PROBE_FAILED',
      };
    }
  }
}
