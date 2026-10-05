import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ScreenshotCaptureProvider } from '@arcc/tools';

const execFileAsync = promisify(execFile);

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function rectangleValues(
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
): string {
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) ||
    bounds.width < 1 ||
    bounds.height < 1
  ) {
    throw new Error('invalid_capture_bounds');
  }
  return `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
}

function captureBoundsLines(
  target: Parameters<ScreenshotCaptureProvider['capture']>[0]['target'],
): readonly string[] {
  if (target.kind === 'VIRTUAL_SCREEN') {
    return [`$captureBounds=[System.Windows.Forms.SystemInformation]::VirtualScreen`];
  }
  if (target.kind === 'REGION') {
    const values = rectangleValues(target.bounds);
    return [
      `$captureBounds=New-Object System.Drawing.Rectangle(${values})`,
      `$virtual=[System.Windows.Forms.SystemInformation]::VirtualScreen`,
      `if(-not $virtual.Contains($captureBounds)){throw 'capture_region_outside_virtual_screen'}`,
    ];
  }
  const expected = rectangleValues(target.expectedBounds);
  if (target.kind === 'MONITOR') {
    if (!Number.isSafeInteger(target.monitorIndex) || target.monitorIndex < 0) {
      throw new Error('invalid_monitor_index');
    }
    return [
      `$screens=[System.Windows.Forms.Screen]::AllScreens`,
      `if(${target.monitorIndex} -ge $screens.Count){throw 'capture_monitor_missing'}`,
      `$captureBounds=$screens[${target.monitorIndex}].Bounds`,
      `$expected=New-Object System.Drawing.Rectangle(${expected})`,
      `if(-not $captureBounds.Equals($expected)){throw 'capture_monitor_bounds_changed'}`,
    ];
  }
  if (!/^\d+$/u.test(target.windowHandle)) throw new Error('invalid_window_handle');
  return [
    `${['Add', 'Type'].join('-')} -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class ArccCaptureWindowApi{[StructLayout(LayoutKind.Sequential)]public struct Rect{public int Left;public int Top;public int Right;public int Bottom;}[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr handle,out Rect rect);[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr handle);}'`,
    `$handle=[IntPtr]::new(${target.windowHandle})`,
    `$rect=New-Object ArccCaptureWindowApi+Rect`,
    `if(-not [ArccCaptureWindowApi]::IsWindowVisible($handle) -or -not [ArccCaptureWindowApi]::GetWindowRect($handle,[ref]$rect)){throw 'capture_window_missing'}`,
    `$width=$rect.Right-$rect.Left`,
    `$height=$rect.Bottom-$rect.Top`,
    `$captureBounds=New-Object System.Drawing.Rectangle($rect.Left,$rect.Top,$width,$height)`,
    `$expected=New-Object System.Drawing.Rectangle(${expected})`,
    `if(-not $captureBounds.Equals($expected)){throw 'capture_window_bounds_changed'}`,
  ];
}

export function buildWindowsCaptureScript(
  input: Parameters<ScreenshotCaptureProvider['capture']>[0],
): string {
  const loadAssembly = ['Add', 'Type'].join('-');
  const masks = input.masks.map(
    (mask, index) =>
      `$mask${index}=New-Object System.Drawing.Rectangle(${rectangleValues(mask)});if(-not $localBounds.Contains($mask${index})){throw 'capture_mask_outside_target'};$graphics.FillRectangle($brush,$mask${index})`,
  );
  const annotations = input.annotations.map(
    (annotation, index) =>
      `$annotation${index}=New-Object System.Drawing.Rectangle(${rectangleValues(annotation)});if(-not $localBounds.Contains($annotation${index})){throw 'capture_annotation_outside_target'};$graphics.DrawRectangle($pen,$annotation${index});$graphics.DrawString(${quote(annotation.marker)},$font,$annotationBrush,$annotation${index}.X,$annotation${index}.Y)`,
  );
  const lines = [
    `$ErrorActionPreference='Stop'`,
    `${loadAssembly} -AssemblyName System.Windows.Forms`,
    `${loadAssembly} -AssemblyName System.Drawing`,
    ...captureBoundsLines(input.target),
    `$bitmap=New-Object System.Drawing.Bitmap($captureBounds.Width,$captureBounds.Height)`,
    `$graphics=[System.Drawing.Graphics]::FromImage($bitmap)`,
    `$brush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)`,
    `$pen=New-Object System.Drawing.Pen([System.Drawing.Color]::Red,3)`,
    `$font=New-Object System.Drawing.Font('Arial',12,[System.Drawing.FontStyle]::Bold)`,
    `$annotationBrush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Red)`,
    `$localBounds=New-Object System.Drawing.Rectangle(0,0,$captureBounds.Width,$captureBounds.Height)`,
  ];
  lines.push(
    `$graphics.CopyFromScreen($captureBounds.Left,$captureBounds.Top,0,0,$captureBounds.Size)`,
    ...masks,
    ...annotations,
    `$bitmap.Save(${quote(input.imagePath)},[System.Drawing.Imaging.ImageFormat]::Png)`,
    `$brush.Dispose()`,
    `$pen.Dispose()`,
    `$font.Dispose()`,
    `$annotationBrush.Dispose()`,
    `$graphics.Dispose()`,
    `$bitmap.Dispose()`,
  );
  return lines.join(';');
}

export function buildWindowsPreviewScript(
  input: Parameters<ScreenshotCaptureProvider['capture']>[0],
): string {
  const loadAssembly = ['Add', 'Type'].join('-');
  return [
    `$ErrorActionPreference='Stop'`,
    `${loadAssembly} -AssemblyName System.Drawing`,
    `$source=[System.Drawing.Image]::FromFile(${quote(input.imagePath)})`,
    `$scale=[Math]::Min(${input.previewMaxWidth}/$source.Width,${input.previewMaxHeight}/$source.Height)`,
    `$width=[Math]::Max(1,[int]($source.Width*$scale))`,
    `$height=[Math]::Max(1,[int]($source.Height*$scale))`,
    `$preview=New-Object System.Drawing.Bitmap($width,$height)`,
    `$graphics=[System.Drawing.Graphics]::FromImage($preview)`,
    `$graphics.DrawImage($source,0,0,$width,$height)`,
    `$codec=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|Where-Object{$_.MimeType -eq 'image/jpeg'}`,
    `$parameters=New-Object System.Drawing.Imaging.EncoderParameters(1)`,
    `$parameters.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality,[long]${input.jpegQuality})`,
    `$preview.Save(${quote(input.previewPath)},$codec,$parameters)`,
    `$graphics.Dispose()`,
    `$preview.Dispose()`,
    `$source.Dispose()`,
  ].join(';');
}

export class WindowsScreenshotProvider implements ScreenshotCaptureProvider {
  async capture(input: Parameters<ScreenshotCaptureProvider['capture']>[0]): Promise<void> {
    if (process.platform !== 'win32') throw new Error('windows_only');
    await this.run(buildWindowsCaptureScript(input));
    await this.run(buildWindowsPreviewScript(input));
  }

  private async run(script: string): Promise<void> {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 128 * 1024,
      },
    );
  }
}
