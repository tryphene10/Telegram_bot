import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { DesktopObservation, WindowSnapshot } from './computer-use-core.js';

const execFileAsync = promisify(execFile);

export function buildWindowsObservationScript(): string {
  return String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ArccWindowApi {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
}
'@
$foreground=[ArccWindowApi]::GetForegroundWindow()
$windows=New-Object System.Collections.ArrayList
$callback=[ArccWindowApi+EnumWindowsProc]{ param([IntPtr]$handle,[IntPtr]$state)
  if(-not [ArccWindowApi]::IsWindowVisible($handle)){ return $true }
  $title=New-Object System.Text.StringBuilder 1024
  [void][ArccWindowApi]::GetWindowText($handle,$title,$title.Capacity)
  if([string]::IsNullOrWhiteSpace($title.ToString())){ return $true }
  $processId=[uint32]0
  [void][ArccWindowApi]::GetWindowThreadProcessId($handle,[ref]$processId)
  $rect=New-Object ArccWindowApi+Rect
  if(-not [ArccWindowApi]::GetWindowRect($handle,[ref]$rect)){ return $true }
  $process=Get-Process -Id $processId -ErrorAction SilentlyContinue
  try { $dpi=[int][ArccWindowApi]::GetDpiForWindow($handle) } catch { $dpi=96 }
  if($dpi -le 0){ $dpi=96 }
  [void]$windows.Add([pscustomobject]@{
    handle=$handle.ToInt64().ToString()
    processId=[int]$processId
    processName=if($process){$process.ProcessName+'.exe'}else{'unknown'}
    title=$title.ToString()
    x=$rect.Left
    y=$rect.Top
    width=[Math]::Max(0,$rect.Right-$rect.Left)
    height=[Math]::Max(0,$rect.Bottom-$rect.Top)
    monitorId=([ArccWindowApi]::MonitorFromWindow($handle,2)).ToInt64().ToString()
    dpi=$dpi
    visible=$true
    enabled=[ArccWindowApi]::IsWindowEnabled($handle)
    foreground=($handle -eq $foreground)
  })
  return $true
}
[void][ArccWindowApi]::EnumWindows($callback,[IntPtr]::Zero)
$windows.ToArray() | ConvertTo-Json -Compress -Depth 4
`.trim();
}

interface RawWindow {
  handle: unknown;
  processId: unknown;
  processName: unknown;
  title: unknown;
  x: unknown;
  y: unknown;
  width: unknown;
  height: unknown;
  monitorId: unknown;
  dpi: unknown;
  visible: unknown;
  enabled: unknown;
  foreground: unknown;
}

function finiteInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`invalid_window_${field}`);
  }
  return value;
}

export function parseWindowsObservation(raw: string, capturedAt: string): DesktopObservation {
  const parsed = JSON.parse(raw) as RawWindow | readonly RawWindow[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const windows: WindowSnapshot[] = rows.map((row) => ({
    handle: String(row.handle),
    processId: finiteInteger(row.processId, 'process_id'),
    processName: String(row.processName),
    title: String(row.title),
    bounds: {
      x: finiteInteger(row.x, 'x'),
      y: finiteInteger(row.y, 'y'),
      width: finiteInteger(row.width, 'width'),
      height: finiteInteger(row.height, 'height'),
    },
    monitorId: String(row.monitorId),
    dpi: finiteInteger(row.dpi, 'dpi'),
    visible: row.visible === true,
    enabled: row.enabled === true,
    foreground: row.foreground === true,
  }));
  const foregroundHandle = windows.find(({ foreground }) => foreground)?.handle;
  const visualFingerprint = createHash('sha256')
    .update(JSON.stringify(windows), 'utf8')
    .digest('hex');
  return {
    capturedAt,
    windows,
    ...(foregroundHandle ? { foregroundHandle } : {}),
    visualFingerprint,
    classification: 'LOCAL_ONLY',
    trust: 'DATA_ONLY',
  };
}

export class WindowsWindowObserver {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async observe(signal: AbortSignal = new AbortController().signal): Promise<DesktopObservation> {
    if (process.platform !== 'win32') throw new Error('windows_only');
    const encoded = Buffer.from(buildWindowsObservationScript(), 'utf16le').toString('base64');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 20_000, maxBuffer: 2 * 1024 * 1024, signal },
    );
    return parseWindowsObservation(stdout.trim() || '[]', this.now().toISOString());
  }
}
