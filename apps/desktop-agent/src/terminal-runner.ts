import { execFile, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';
import type { SecretRedactor } from '@arcc/security';
import { buildRestrictedEnvironment, type CompiledTerminalProfile } from '@arcc/tools';

const execFileAsync = promisify(execFile);

export interface ProcessExit {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface RunningTerminalProcess {
  readonly pid: number;
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly completion: Promise<ProcessExit>;
}

export interface TerminalProcessController {
  start(input: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly environment: Readonly<Record<string, string>>;
  }): RunningTerminalProcess;
  killTree(pid: number): Promise<void>;
}

export interface TerminalAuditSink {
  record(event: {
    readonly commandHash: string;
    readonly profile: string;
    readonly status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT' | 'OUTPUT_LIMIT';
    readonly exitCode?: number | null;
    readonly outputBytes: number;
    readonly redactions: number;
  }): Promise<void>;
}

export interface TerminalResult {
  readonly status: 'COMPLETED' | 'FAILED';
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly outputBytes: number;
  readonly redactions: number;
}

export class TerminalExecutionError extends Error {
  constructor(
    readonly reason: 'cancelled' | 'timeout' | 'output_limit' | 'process_start_failed',
    options?: ErrorOptions,
  ) {
    super(`Terminal execution failed: ${reason}`, options);
    this.name = 'TerminalExecutionError';
  }
}

export class WindowsProcessController implements TerminalProcessController {
  start(input: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly environment: Readonly<Record<string, string>>;
  }): RunningTerminalProcess {
    if (process.platform !== 'win32') throw new TerminalExecutionError('process_start_failed');
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: { ...input.environment },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.pid === undefined || child.stdout === null || child.stderr === null) {
      throw new TerminalExecutionError('process_start_failed');
    }
    const completion = new Promise<ProcessExit>((resolve, reject) => {
      child.once('error', (error) =>
        reject(new TerminalExecutionError('process_start_failed', { cause: error })),
      );
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    return { pid: child.pid, stdout: child.stdout, stderr: child.stderr, completion };
  }

  async killTree(pid: number): Promise<void> {
    if (!Number.isSafeInteger(pid) || pid < 1) return;
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 128 * 1024,
      });
    } catch (error) {
      try {
        process.kill(pid, 0);
      } catch {
        // The process exited between the decision and taskkill.
        return;
      }
      throw new Error('process_tree_termination_failed', { cause: error });
    }
  }
}

type OutputChannel = 'STDOUT' | 'STDERR';

class BoundedRedactedOutput {
  private readonly decoders = {
    STDOUT: new StringDecoder('utf8'),
    STDERR: new StringDecoder('utf8'),
  };
  private readonly partial = { STDOUT: '', STDERR: '' };
  private readonly privateKeyBlock = { STDOUT: false, STDERR: false };
  private readonly chunks = { STDOUT: [] as string[], STDERR: [] as string[] };
  outputBytes = 0;
  redactions = 0;

  constructor(
    private readonly maximumBytes: number,
    private readonly redactor: SecretRedactor,
    private readonly stream?: (channel: OutputChannel, text: string) => Promise<void> | void,
  ) {}

  async consume(source: AsyncIterable<Uint8Array>, channel: OutputChannel): Promise<void> {
    for await (const chunk of source) {
      this.outputBytes += chunk.byteLength;
      if (this.outputBytes > this.maximumBytes) throw new TerminalExecutionError('output_limit');
      this.partial[channel] += this.decoders[channel].write(Buffer.from(chunk));
      await this.flushLines(channel);
    }
    this.partial[channel] += this.decoders[channel].end();
    if (this.partial[channel]) {
      await this.emit(channel, this.partial[channel]);
      this.partial[channel] = '';
    }
  }

  result(channel: OutputChannel): string {
    return this.chunks[channel].join('');
  }

  private async flushLines(channel: OutputChannel): Promise<void> {
    for (;;) {
      const index = this.partial[channel].indexOf('\n');
      if (index < 0) return;
      const line = this.partial[channel].slice(0, index + 1);
      this.partial[channel] = this.partial[channel].slice(index + 1);
      await this.emit(channel, line);
    }
  }

  private async emit(channel: OutputChannel, line: string): Promise<void> {
    if (this.privateKeyBlock[channel]) {
      if (/-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu.test(line)) {
        this.privateKeyBlock[channel] = false;
      }
      return;
    }
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu.test(line)) {
      this.privateKeyBlock[channel] = true;
      this.redactions += 1;
      line = '[REDACTED]\n';
    } else {
      const redacted = this.redactor.redact(line);
      line = redacted.text;
      this.redactions += redacted.replacements;
    }
    this.chunks[channel].push(line);
    await this.stream?.(channel, line);
  }
}

export class SecureTerminalRunner {
  constructor(
    private readonly processes: TerminalProcessController,
    private readonly redactor: SecretRedactor,
    private readonly audit: TerminalAuditSink,
  ) {}

  async execute(input: {
    readonly profile: CompiledTerminalProfile;
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly signal?: AbortSignal;
    readonly onOutput?: (channel: OutputChannel, text: string) => Promise<void> | void;
  }): Promise<TerminalResult> {
    const environment = buildRestrictedEnvironment(input.profile, input.environment ?? {});
    let running: RunningTerminalProcess;
    try {
      running = this.processes.start({
        executable: input.profile.executable,
        args: input.profile.args,
        cwd: input.profile.cwd,
        environment,
      });
    } catch (error) {
      await this.audit.record({
        commandHash: input.profile.commandHash,
        profile: input.profile.name,
        status: 'FAILED',
        outputBytes: 0,
        redactions: 0,
      });
      if (error instanceof TerminalExecutionError) throw error;
      throw new TerminalExecutionError('process_start_failed', { cause: error });
    }

    const output = new BoundedRedactedOutput(
      input.profile.maxOutputBytes,
      this.redactor,
      input.onOutput,
    );
    const consumers = Promise.all([
      output.consume(running.stdout, 'STDOUT'),
      output.consume(running.stderr, 'STDERR'),
    ]);
    let rejectControl: ((error: TerminalExecutionError) => void) | undefined;
    const control = new Promise<never>((_resolve, reject) => {
      rejectControl = reject;
    });
    const abort = () => rejectControl?.(new TerminalExecutionError('cancelled'));
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) abort();
    const timer = setTimeout(
      () => rejectControl?.(new TerminalExecutionError('timeout')),
      input.profile.timeoutMs,
    );
    timer.unref?.();
    try {
      const exit = await Promise.race([
        running.completion,
        control,
        consumers.then(() => new Promise<never>(() => undefined)),
      ]);
      await consumers;
      const status = exit.exitCode === 0 ? 'COMPLETED' : 'FAILED';
      const result: TerminalResult = {
        status,
        exitCode: exit.exitCode,
        stdout: output.result('STDOUT'),
        stderr: output.result('STDERR'),
        outputBytes: output.outputBytes,
        redactions: output.redactions,
      };
      await this.audit.record({
        commandHash: input.profile.commandHash,
        profile: input.profile.name,
        status,
        exitCode: exit.exitCode,
        outputBytes: output.outputBytes,
        redactions: output.redactions,
      });
      return result;
    } catch (error) {
      await this.processes.killTree(running.pid);
      await Promise.allSettled([consumers, running.completion]);
      const reason =
        error instanceof TerminalExecutionError ? error.reason : 'process_start_failed';
      const status =
        reason === 'cancelled'
          ? 'CANCELLED'
          : reason === 'timeout'
            ? 'TIMED_OUT'
            : reason === 'output_limit'
              ? 'OUTPUT_LIMIT'
              : 'FAILED';
      await this.audit.record({
        commandHash: input.profile.commandHash,
        profile: input.profile.name,
        status,
        outputBytes: output.outputBytes,
        redactions: output.redactions,
      });
      if (error instanceof TerminalExecutionError) throw error;
      throw new TerminalExecutionError('process_start_failed', { cause: error });
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
    }
  }
}
