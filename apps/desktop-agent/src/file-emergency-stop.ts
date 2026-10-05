import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ComputerUseError, type EmergencyStopPort } from './computer-use-core.js';

export interface EmergencyStopState {
  readonly active: boolean;
  readonly reason?: string;
  readonly activatedAt?: string;
}

interface EmergencyStopDocument {
  readonly active: true;
  readonly reason: string;
  readonly activatedAt: string;
}

export function defaultEmergencyStopPath(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = environment.ARCC_EMERGENCY_STOP_FILE?.trim();
  if (configured) return resolve(configured);
  return join(environment.LOCALAPPDATA?.trim() || tmpdir(), 'ARCC', 'computer-use.stop.json');
}

function parseDocument(raw: string): EmergencyStopState {
  try {
    const value = JSON.parse(raw) as Partial<EmergencyStopDocument>;
    if (
      value.active !== true ||
      typeof value.reason !== 'string' ||
      !value.reason.trim() ||
      typeof value.activatedAt !== 'string' ||
      !value.activatedAt.trim()
    ) {
      return { active: true, reason: 'invalid_emergency_stop_file' };
    }
    return { active: true, reason: value.reason, activatedAt: value.activatedAt };
  } catch {
    return { active: true, reason: 'invalid_emergency_stop_file' };
  }
}

export function readEmergencyStopStateSync(path = defaultEmergencyStopPath()): EmergencyStopState {
  try {
    return parseDocument(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { active: false };
    return { active: true, reason: 'emergency_stop_file_unreadable' };
  }
}

export async function readEmergencyStopState(
  path = defaultEmergencyStopPath(),
): Promise<EmergencyStopState> {
  try {
    return parseDocument(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { active: false };
    return { active: true, reason: 'emergency_stop_file_unreadable' };
  }
}

export async function activateEmergencyStop(
  path = defaultEmergencyStopPath(),
  reason = 'manual_emergency_stop',
  now: () => Date = () => new Date(),
): Promise<EmergencyStopState> {
  const current = await readEmergencyStopState(path);
  if (current.active) return current;
  const document: EmergencyStopDocument = {
    active: true,
    reason: reason.trim() || 'manual_emergency_stop',
    activatedAt: now().toISOString(),
  };
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(document)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    const concurrent = await readEmergencyStopState(path);
    if (!concurrent.active) throw error;
    return concurrent;
  }
  return document;
}

export async function resetEmergencyStop(path = defaultEmergencyStopPath()): Promise<void> {
  await rm(path, { force: true });
}

export class FileEmergencyStopLatch implements EmergencyStopPort {
  private controller = new AbortController();
  private reason: string | undefined;
  private readonly timer: NodeJS.Timeout;

  constructor(
    readonly path = defaultEmergencyStopPath(),
    pollIntervalMs = 100,
  ) {
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 25 || pollIntervalMs > 5_000) {
      throw new ComputerUseError('invalid_emergency_stop_poll_interval');
    }
    this.refresh();
    this.timer = setInterval(() => this.refresh(), pollIntervalMs);
    this.timer.unref();
  }

  get signal(): AbortSignal {
    this.refresh();
    return this.controller.signal;
  }

  assertRunning(): void {
    this.refresh();
    if (this.reason) throw new ComputerUseError(`emergency_stop:${this.reason}`);
  }

  close(): void {
    clearInterval(this.timer);
  }

  private refresh(): void {
    const state = readEmergencyStopStateSync(this.path);
    if (state.active) {
      this.reason = state.reason ?? 'emergency_stop';
      if (!this.controller.signal.aborted) {
        this.controller.abort(new ComputerUseError(`emergency_stop:${this.reason}`));
      }
      return;
    }
    this.reason = undefined;
    if (this.controller.signal.aborted) this.controller = new AbortController();
  }
}
