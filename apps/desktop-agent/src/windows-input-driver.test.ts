import { describe, expect, it } from 'vitest';
import { buildWindowsInputScript } from './windows-input-driver.js';

describe('WindowsInputDriver', () => {
  it('checks foreground and unchanged bounds before a click', () => {
    const script = buildWindowsInputScript({
      kind: 'CLICK',
      windowHandle: '42',
      expectedBounds: { x: 10, y: 20, width: 500, height: 400 },
      point: { x: 50, y: 60 },
    });
    expect(script).toContain('GetForegroundWindow() -ne $handle');
    expect(script).toContain("throw 'window_bounds_changed'");
    expect(script).toContain('Click(50,60)');
  });

  it('refuses coordinates outside the expected window', () => {
    expect(() =>
      buildWindowsInputScript({
        kind: 'CLICK',
        windowHandle: '42',
        expectedBounds: { x: 10, y: 20, width: 500, height: 400 },
        point: { x: 900, y: 60 },
      }),
    ).toThrow('point_outside_expected_window');
  });

  it('encodes text without clipboard and requires a confirmed non-password target', () => {
    const script = buildWindowsInputScript({
      kind: 'TYPE_TEXT',
      windowHandle: '42',
      expectedBounds: { x: 10, y: 20, width: 500, height: 400 },
      text: "Bonjour ' monde",
      passwordTargetConfirmedFalse: true,
    });
    expect(script).toContain('TypeUnicode');
    expect(script).not.toContain('Clipboard');
    expect(script).not.toContain("Bonjour ' monde");
  });
});
