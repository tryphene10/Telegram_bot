import { describe, expect, it } from 'vitest';
import { buildWindowControlScript } from './windows-window-controller.js';

describe('WindowsWindowController', () => {
  it('binds every operation to an exact native window handle', () => {
    const script = buildWindowControlScript({ handle: '42', operation: 'ACTIVATE' });
    expect(script).toContain('$handle=[IntPtr]::new(42)');
    expect(script).toContain('IsWindowVisible');
    expect(script).toContain('SetForegroundWindow');
  });

  it('validates move and resize bounds before invoking Windows', () => {
    expect(() =>
      buildWindowControlScript({
        handle: '42',
        operation: 'MOVE_RESIZE',
        bounds: { x: 0, y: 0, width: 10, height: 10 },
      }),
    ).toThrow('invalid_window_bounds');
    expect(
      buildWindowControlScript({
        handle: '42',
        operation: 'MOVE_RESIZE',
        bounds: { x: -100, y: 0, width: 800, height: 600 },
      }),
    ).toContain('MoveWindow($handle,-100,0,800,600');
  });
});
