import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Rectangle } from './computer-use-core.js';

const execFileAsync = promisify(execFile);

export type WindowOperation = 'ACTIVATE' | 'MOVE_RESIZE' | 'MINIMIZE' | 'MAXIMIZE' | 'RESTORE';

export class WindowControlError extends Error {
  constructor(readonly reason: string) {
    super(`Window control refused: ${reason}`);
    this.name = 'WindowControlError';
  }
}

export function buildWindowControlScript(input: {
  readonly handle: string;
  readonly operation: WindowOperation;
  readonly bounds?: Rectangle;
}): string {
  if (!/^\d+$/u.test(input.handle)) throw new WindowControlError('invalid_window_handle');
  if (input.operation === 'MOVE_RESIZE') {
    const bounds = input.bounds;
    if (
      !bounds ||
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) ||
      bounds.width < 100 ||
      bounds.height < 100 ||
      bounds.width > 32_768 ||
      bounds.height > 32_768
    ) {
      throw new WindowControlError('invalid_window_bounds');
    }
  }
  const bounds = input.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
  return String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ArccWindowControl {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
}
'@
$handle=[IntPtr]::new(${input.handle})
if(-not [ArccWindowControl]::IsWindow($handle) -or -not [ArccWindowControl]::IsWindowVisible($handle)){throw 'window_not_available'}
$success=$false
switch('${input.operation}'){
  'ACTIVATE' { $success=[ArccWindowControl]::SetForegroundWindow($handle) }
  'MOVE_RESIZE' { $success=[ArccWindowControl]::MoveWindow($handle,${bounds.x},${bounds.y},${bounds.width},${bounds.height},$true) }
  'MINIMIZE' { $success=[ArccWindowControl]::ShowWindow($handle,6) }
  'MAXIMIZE' { $success=[ArccWindowControl]::ShowWindow($handle,3) }
  'RESTORE' { $success=[ArccWindowControl]::ShowWindow($handle,9) }
  default { throw 'window_operation_not_allowed' }
}
if(-not $success){throw 'window_operation_failed'}
[pscustomobject]@{
  success=$true
  operation='${input.operation}'
  foreground=([ArccWindowControl]::GetForegroundWindow() -eq $handle)
} | ConvertTo-Json -Compress
`.trim();
}

export class WindowsWindowController {
  async perform(input: {
    readonly handle: string;
    readonly operation: WindowOperation;
    readonly bounds?: Rectangle;
    readonly signal?: AbortSignal;
  }): Promise<Readonly<{ success: true; operation: WindowOperation; foreground: boolean }>> {
    if (process.platform !== 'win32') throw new WindowControlError('windows_only');
    const script = buildWindowControlScript(input);
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 10_000, maxBuffer: 128 * 1024, signal: input.signal },
    );
    const result = JSON.parse(stdout.trim()) as {
      success?: unknown;
      operation?: unknown;
      foreground?: unknown;
    };
    if (result.success !== true || result.operation !== input.operation) {
      throw new WindowControlError('invalid_window_receipt');
    }
    return { success: true, operation: input.operation, foreground: result.foreground === true };
  }
}
