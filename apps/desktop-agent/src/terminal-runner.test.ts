import { SecretRedactor } from '@arcc/security';
import type { CompiledTerminalProfile } from '@arcc/tools';
import { describe, expect, it, vi } from 'vitest';
import {
  SecureTerminalRunner,
  WindowsProcessController,
  type ProcessExit,
  type RunningTerminalProcess,
  type TerminalProcessController,
} from './terminal-runner.js';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function* chunks(values: readonly string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield Buffer.from(value);
}

class FakeProcesses implements TerminalProcessController {
  readonly exit = deferred<ProcessExit>();
  readonly killTree = vi.fn(async () => this.exit.resolve({ exitCode: null, signal: 'SIGKILL' }));
  readonly start = vi.fn((): RunningTerminalProcess => ({
    pid: 42,
    stdout: chunks(this.stdout),
    stderr: chunks(this.stderr),
    completion: this.exit.promise,
  }));

  constructor(
    private readonly stdout: readonly string[] = [],
    private readonly stderr: readonly string[] = [],
  ) {}
}

const profile: CompiledTerminalProfile = {
  name: 'test',
  executable: 'C:\\safe\\tool.exe',
  args: ['version'],
  cwd: 'C:\\project\\src',
  environmentAllowlist: ['ALLOWED'],
  timeoutMs: 1_000,
  maxOutputBytes: 10_000,
  network: 'DENY',
  mutatesProject: false,
  kind: 'NORMAL',
  risk: 'LOW',
  actionCategory: 'READ',
  commandHash: 'a'.repeat(64),
};

describe('SecureTerminalRunner', () => {
  it('streams and stores only redacted bounded output', async () => {
    const processes = new FakeProcesses([
      'token=super-secret\n',
      '-----BEGIN PRIVATE KEY-----\nmaterial\n-----END PRIVATE KEY-----\nok\n',
    ]);
    processes.exit.resolve({ exitCode: 0, signal: null });
    const audit = { record: vi.fn(async () => undefined) };
    const onOutput = vi.fn();
    const result = await new SecureTerminalRunner(processes, new SecretRedactor(), audit).execute({
      profile,
      environment: { ALLOWED: 'yes', BLOCKED: 'no' },
      onOutput,
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.stdout).toContain('[REDACTED]');
    expect(result.stdout).toContain('ok');
    expect(result.stdout).not.toContain('super-secret');
    expect(result.stdout).not.toContain('material');
    expect(JSON.stringify(onOutput.mock.calls)).not.toContain('super-secret');
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('super-secret');
    expect(processes.start).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: profile.executable,
        args: profile.args,
        environment: expect.not.objectContaining({ BLOCKED: 'no' }),
      }),
    );
  });

  it('kills the entire process tree on timeout', async () => {
    const processes = new FakeProcesses();
    const runner = new SecureTerminalRunner(processes, new SecretRedactor(), { record: vi.fn() });
    await expect(runner.execute({ profile: { ...profile, timeoutMs: 5 } })).rejects.toMatchObject({
      reason: 'timeout',
    });
    expect(processes.killTree).toHaveBeenCalledWith(42);
  });

  it('kills the entire process tree on cancellation', async () => {
    const processes = new FakeProcesses();
    const controller = new AbortController();
    const execution = new SecureTerminalRunner(processes, new SecretRedactor(), {
      record: vi.fn(),
    }).execute({ profile, signal: controller.signal });
    controller.abort();
    await expect(execution).rejects.toMatchObject({ reason: 'cancelled' });
    expect(processes.killTree).toHaveBeenCalledWith(42);
  });

  it('kills the process tree before output can exceed its bound', async () => {
    const processes = new FakeProcesses(['0123456789']);
    const runner = new SecureTerminalRunner(processes, new SecretRedactor(), { record: vi.fn() });
    await expect(
      runner.execute({ profile: { ...profile, maxOutputBytes: 5 } }),
    ).rejects.toMatchObject({ reason: 'output_limit' });
    expect(processes.killTree).toHaveBeenCalledWith(42);
  });

  it.runIf(process.platform === 'win32')(
    'executes an exact Windows command without a shell',
    async () => {
      const executable = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\whoami.exe`;
      const runner = new SecureTerminalRunner(
        new WindowsProcessController(),
        new SecretRedactor(),
        { record: vi.fn() },
      );
      const result = await runner.execute({
        profile: {
          ...profile,
          executable,
          args: ['/user'],
          cwd: process.cwd(),
          timeoutMs: 5_000,
        },
      });
      expect(result.status).toBe('COMPLETED');
      expect(result.exitCode).toBe(0);
      expect(result.outputBytes).toBeGreaterThan(0);
    },
  );
});
