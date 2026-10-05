import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdaptiveContextObserver } from './adaptive-computer-use.js';
import { WindowsWindowObserver } from './windows-window-observer.js';

const execFileAsync = promisify(execFile);

export interface UserActivitySample {
  readonly capturedAt: string;
  readonly idleMs: number;
}

export interface UserActivityProvider {
  sample(): Promise<UserActivitySample>;
}

export function buildWindowsUserActivityScript(): string {
  return String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ArccLastInputApi {
  [StructLayout(LayoutKind.Sequential)] public struct LastInputInfo { public uint Size; public uint Time; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInputInfo info);
  [DllImport("kernel32.dll")] static extern ulong GetTickCount64();
  public static uint IdleMilliseconds() {
    var info = new LastInputInfo(); info.Size = (uint)Marshal.SizeOf(info);
    if (!GetLastInputInfo(ref info)) throw new InvalidOperationException("last_input_unavailable");
    return unchecked((uint)GetTickCount64() - info.Time);
  }
}
'@
[pscustomobject]@{idleMs=[long][ArccLastInputApi]::IdleMilliseconds()}|ConvertTo-Json -Compress
`.trim();
}

export class WindowsUserActivityProvider implements UserActivityProvider {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async sample(): Promise<UserActivitySample> {
    if (process.platform !== 'win32') throw new Error('windows_only');
    const encoded = Buffer.from(buildWindowsUserActivityScript(), 'utf16le').toString('base64');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 20_000, maxBuffer: 128 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim()) as { idleMs?: unknown };
    if (
      typeof parsed.idleMs !== 'number' ||
      !Number.isSafeInteger(parsed.idleMs) ||
      parsed.idleMs < 0
    ) {
      throw new Error('invalid_last_input_sample');
    }
    return { capturedAt: this.now().toISOString(), idleMs: parsed.idleMs };
  }
}

export class UserActivityMonitor {
  private lastAutomationInputAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly provider: UserActivityProvider,
    private readonly quietPeriodMs = 2_000,
    private readonly automationGraceMs = 750,
    private readonly now: () => number = Date.now,
  ) {
    if (
      !Number.isSafeInteger(quietPeriodMs) ||
      quietPeriodMs < 100 ||
      !Number.isSafeInteger(automationGraceMs) ||
      automationGraceMs < 0
    ) {
      throw new Error('invalid_user_activity_threshold');
    }
  }

  recordAutomationInput(): void {
    this.lastAutomationInputAt = this.now();
  }

  async userActivityDetected(): Promise<boolean> {
    const sample = await this.provider.sample();
    return (
      sample.idleMs < this.quietPeriodMs &&
      this.now() - this.lastAutomationInputAt > this.automationGraceMs
    );
  }
}

export class WindowsAdaptiveContextObserver implements AdaptiveContextObserver {
  constructor(
    private readonly windows = new WindowsWindowObserver(),
    private readonly activity = new UserActivityMonitor(new WindowsUserActivityProvider()),
  ) {}

  async observe(input: {
    readonly missionId: string;
    readonly stepId: string;
    readonly signal: AbortSignal;
  }): Promise<Readonly<{ contextFingerprint: string; userActivityDetected: boolean }>> {
    void input.missionId;
    void input.stepId;
    const [desktop, userActivityDetected] = await Promise.all([
      this.windows.observe(input.signal),
      this.activity.userActivityDetected(),
    ]);
    return { contextFingerprint: desktop.visualFingerprint, userActivityDetected };
  }
}
