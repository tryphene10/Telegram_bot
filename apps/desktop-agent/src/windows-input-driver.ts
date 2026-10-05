import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Rectangle } from './computer-use-core.js';

const execFileAsync = promisify(execFile);

export type NativeInputRequest =
  | Readonly<{
      kind: 'CLICK';
      windowHandle: string;
      expectedBounds: Rectangle;
      point: Readonly<{ x: number; y: number }>;
    }>
  | Readonly<{
      kind: 'TYPE_TEXT';
      windowHandle: string;
      expectedBounds: Rectangle;
      text: string;
      passwordTargetConfirmedFalse: true;
    }>;

export class WindowsInputError extends Error {
  constructor(readonly reason: string) {
    super(`Windows input refused: ${reason}`);
    this.name = 'WindowsInputError';
  }
}

function validateBounds(bounds: Rectangle): void {
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) ||
    bounds.width < 1 ||
    bounds.height < 1
  ) {
    throw new WindowsInputError('invalid_expected_bounds');
  }
}

function hasForbiddenControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  });
}

export function buildWindowsInputScript(request: NativeInputRequest): string {
  if (!/^\d+$/u.test(request.windowHandle)) throw new WindowsInputError('invalid_window_handle');
  validateBounds(request.expectedBounds);
  if (
    request.kind === 'CLICK' &&
    (!Number.isSafeInteger(request.point.x) ||
      !Number.isSafeInteger(request.point.y) ||
      request.point.x < request.expectedBounds.x ||
      request.point.y < request.expectedBounds.y ||
      request.point.x >= request.expectedBounds.x + request.expectedBounds.width ||
      request.point.y >= request.expectedBounds.y + request.expectedBounds.height)
  ) {
    throw new WindowsInputError('point_outside_expected_window');
  }
  if (
    request.kind === 'TYPE_TEXT' &&
    (!request.text || request.text.length > 2_000 || hasForbiddenControlCharacter(request.text))
  ) {
    throw new WindowsInputError('invalid_text');
  }
  const textBase64 =
    request.kind === 'TYPE_TEXT' ? Buffer.from(request.text, 'utf8').toString('base64') : '';
  const point = request.kind === 'CLICK' ? request.point : { x: 0, y: 0 };
  return String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ArccInputGuard {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public InputUnion data; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MouseInput mouse; [FieldOffset(0)] public KeyboardInput keyboard; }
  [StructLayout(LayoutKind.Sequential)] public struct MouseInput { public int dx; public int dy; public uint mouseData; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KeyboardInput { public ushort virtualKey; public ushort scanCode; public uint flags; public uint time; public IntPtr extra; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, Input[] inputs, int size);
  public static bool Click(int x, int y) {
    if(!SetCursorPos(x,y)) return false;
    var inputs=new Input[2];
    inputs[0].type=0; inputs[0].data.mouse.flags=0x0002;
    inputs[1].type=0; inputs[1].data.mouse.flags=0x0004;
    return SendInput(2,inputs,Marshal.SizeOf(typeof(Input)))==2;
  }
  public static bool TypeUnicode(string text) {
    foreach(char c in text) {
      var inputs=new Input[2];
      inputs[0].type=1; inputs[0].data.keyboard.scanCode=c; inputs[0].data.keyboard.flags=0x0004;
      inputs[1].type=1; inputs[1].data.keyboard.scanCode=c; inputs[1].data.keyboard.flags=0x0004|0x0002;
      if(SendInput(2,inputs,Marshal.SizeOf(typeof(Input)))!=2) return false;
    }
    return true;
  }
}
'@
$handle=[IntPtr]::new(${request.windowHandle})
if([ArccInputGuard]::GetForegroundWindow() -ne $handle){throw 'unexpected_foreground_window'}
$rect=New-Object ArccInputGuard+Rect
if(-not [ArccInputGuard]::GetWindowRect($handle,[ref]$rect)){throw 'window_bounds_unavailable'}
if($rect.Left -ne ${request.expectedBounds.x} -or $rect.Top -ne ${request.expectedBounds.y} -or ($rect.Right-$rect.Left) -ne ${request.expectedBounds.width} -or ($rect.Bottom-$rect.Top) -ne ${request.expectedBounds.height}){throw 'window_bounds_changed'}
$success=$false
if('${request.kind}' -eq 'CLICK'){
  if(${point.x} -lt $rect.Left -or ${point.x} -ge $rect.Right -or ${point.y} -lt $rect.Top -or ${point.y} -ge $rect.Bottom){throw 'point_outside_current_window'}
  $success=[ArccInputGuard]::Click(${point.x},${point.y})
} else {
  $text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${textBase64}'))
  $success=[ArccInputGuard]::TypeUnicode($text)
}
if(-not $success){throw 'send_input_failed'}
[pscustomobject]@{success=$true;kind='${request.kind}'} | ConvertTo-Json -Compress
`.trim();
}

export class WindowsInputDriver {
  async perform(
    request: NativeInputRequest,
    signal?: AbortSignal,
  ): Promise<Readonly<{ success: true; kind: NativeInputRequest['kind'] }>> {
    if (process.platform !== 'win32') throw new WindowsInputError('windows_only');
    const encoded = Buffer.from(buildWindowsInputScript(request), 'utf16le').toString('base64');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 10_000, maxBuffer: 128 * 1024, signal },
    );
    const result = JSON.parse(stdout.trim()) as { success?: unknown; kind?: unknown };
    if (result.success !== true || result.kind !== request.kind) {
      throw new WindowsInputError('invalid_input_receipt');
    }
    return { success: true, kind: request.kind };
  }
}
