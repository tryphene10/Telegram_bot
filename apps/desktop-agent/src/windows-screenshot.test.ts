import { describe, expect, it } from 'vitest';
import {
  buildWindowsCaptureScript,
  buildWindowsPreviewScript,
  WindowsScreenshotProvider,
} from './windows-screenshot.js';

describe('WindowsScreenshotProvider', () => {
  it('is a concrete capture provider without exposing a command surface', () => {
    const provider = new WindowsScreenshotProvider();
    expect(provider.capture).toEqual(expect.any(Function));
    expect(provider).not.toHaveProperty('command');
    expect(provider).not.toHaveProperty('shell');
  });

  it('builds fixed masking and preview operations with quoted paths', () => {
    const input = {
      imagePath: "C:\\capture\\owner's.png",
      previewPath: 'C:\\capture\\preview.jpg',
      target: { kind: 'REGION' as const, bounds: { x: 10, y: 20, width: 300, height: 200 } },
      masks: [{ x: 1, y: 2, width: 3, height: 4 }],
      annotations: [{ x: 10, y: 20, width: 30, height: 40, marker: 'TARGET_1' }],
      previewMaxWidth: 640,
      previewMaxHeight: 360,
      jpegQuality: 60,
    };
    const capture = buildWindowsCaptureScript(input);
    const preview = buildWindowsPreviewScript(input);
    expect(capture).toContain('Rectangle(10,20,300,200)');
    expect(capture).toContain('$graphics.FillRectangle($brush,$mask0)');
    expect(capture).toContain("$graphics.DrawString('TARGET_1'");
    expect(capture).toContain('owner');
    expect(preview).toContain('[long]60');
  });

  it('pins monitor and window captures to their expected bounds', () => {
    const common = {
      imagePath: 'C:\\capture\\image.png',
      previewPath: 'C:\\capture\\preview.jpg',
      masks: [],
      annotations: [],
      previewMaxWidth: 640,
      previewMaxHeight: 360,
      jpegQuality: 60,
    };
    const monitor = buildWindowsCaptureScript({
      ...common,
      target: {
        kind: 'MONITOR',
        monitorIndex: 1,
        expectedBounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      },
    });
    const window = buildWindowsCaptureScript({
      ...common,
      target: {
        kind: 'WINDOW',
        windowHandle: '42',
        expectedBounds: { x: 10, y: 20, width: 800, height: 600 },
      },
    });
    expect(monitor).toContain("throw 'capture_monitor_bounds_changed'");
    expect(window).toContain('GetWindowRect($handle,[ref]$rect)');
    expect(window).toContain("throw 'capture_window_bounds_changed'");
  });
});
