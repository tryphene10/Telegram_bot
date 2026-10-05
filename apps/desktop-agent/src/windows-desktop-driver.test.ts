import { describe, expect, it, vi } from 'vitest';
import { WindowsDesktopDriver } from './windows-desktop-driver.js';
import type { DesktopAction, DesktopObservation } from './computer-use-core.js';

const target = {
  handle: '42',
  processId: 100,
  processName: 'test.exe',
  title: 'Test',
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  monitorId: '1',
  dpi: 96,
  visible: true,
  enabled: true,
  foreground: true,
};
const observation: DesktopObservation = {
  capturedAt: '2026-10-01T12:00:00.000Z',
  windows: [target],
  foregroundHandle: '42',
  visualFingerprint: 'a',
  classification: 'LOCAL_ONLY',
  trust: 'DATA_ONLY',
};

describe('WindowsDesktopDriver', () => {
  it('routes semantic actions to UIA and verifies the target again', async () => {
    const uia = {
      perform: vi.fn(async () => ({ success: true, operation: 'INVOKE', matchCount: 1 })),
      inspect: vi.fn(async () => ({
        windowHandle: '42',
        capturedAt: '',
        truncated: false,
        classification: 'LOCAL_ONLY',
        trust: 'DATA_ONLY',
        elements: [
          {
            name: 'Save',
            automationId: 'save',
            className: 'Button',
            controlType: 'Button',
            enabled: true,
            offscreen: false,
            password: false,
            bounds: { x: 1, y: 1, width: 20, height: 20 },
          },
        ],
      })),
    };
    const driver = new WindowsDesktopDriver(
      { observe: vi.fn(async () => observation) } as never,
      uia as never,
      {} as never,
      {} as never,
    );
    const action: DesktopAction = {
      id: 'save',
      kind: 'UIA_INVOKE',
      channel: 'UIA',
      applicationKey: 'test',
      expectedWindow: { handle: '42' },
      selector: { automationId: 'save' },
      risk: 'LOW',
      verification: { kind: 'UIA', expected: 'save exists' },
    };
    const receipt = await driver.perform({ action, target, signal: new AbortController().signal });
    await expect(
      driver.verify({
        action,
        target,
        before: observation,
        after: observation,
        receipt,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ passed: true });
    expect(uia.perform).toHaveBeenCalledOnce();
    expect(uia.inspect).toHaveBeenCalledOnce();
  });

  it('routes a window move through the native controller', async () => {
    const windows = {
      perform: vi.fn(async () => ({ success: true, operation: 'MOVE_RESIZE', foreground: true })),
    };
    const driver = new WindowsDesktopDriver(
      {} as never,
      {} as never,
      windows as never,
      {} as never,
    );
    const action: DesktopAction = {
      id: 'move',
      kind: 'WINDOW_MOVE_RESIZE',
      channel: 'UIA',
      applicationKey: 'test',
      expectedWindow: { handle: '42' },
      targetBounds: { x: 10, y: 20, width: 640, height: 480 },
      risk: 'MEDIUM',
      verification: { kind: 'WINDOW', expected: 'bounds changed' },
    };
    await driver.perform({ action, target, signal: new AbortController().signal });
    expect(windows.perform).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'MOVE_RESIZE', bounds: action.targetBounds }),
    );
  });
});
