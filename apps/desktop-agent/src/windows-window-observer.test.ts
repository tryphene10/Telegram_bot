import { describe, expect, it } from 'vitest';
import {
  buildWindowsObservationScript,
  parseWindowsObservation,
} from './windows-window-observer.js';

describe('WindowsWindowObserver', () => {
  it('builds a bounded semantic window inventory script', () => {
    const script = buildWindowsObservationScript();
    expect(script).toContain('EnumWindows');
    expect(script).toContain('GetForegroundWindow');
    expect(script).toContain('GetDpiForWindow');
    expect(script).not.toContain('MainWindowTitle');
  });

  it('marks observed window data as local-only and untrusted', () => {
    const observation = parseWindowsObservation(
      JSON.stringify([
        {
          handle: '42',
          processId: 100,
          processName: 'notepad.exe',
          title: 'Notes',
          x: 1,
          y: 2,
          width: 300,
          height: 200,
          monitorId: '1',
          dpi: 144,
          visible: true,
          enabled: true,
          foreground: true,
        },
      ]),
      '2026-10-01T12:00:00.000Z',
    );
    expect(observation).toMatchObject({
      foregroundHandle: '42',
      classification: 'LOCAL_ONLY',
      trust: 'DATA_ONLY',
      windows: [{ dpi: 144, monitorId: '1' }],
    });
    expect(observation.visualFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });
});
