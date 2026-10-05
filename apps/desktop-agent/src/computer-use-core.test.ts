import { describe, expect, it, vi } from 'vitest';
import {
  ComputerUseCore,
  EmergencyStopLatch,
  UiLeaseManager,
  hashDesktopAction,
  type DesktopAction,
  type DesktopDriver,
  type DesktopObservation,
} from './computer-use-core.js';

const observation: DesktopObservation = {
  capturedAt: '2026-10-01T12:00:00.000Z',
  foregroundHandle: '42',
  visualFingerprint: 'screen-a',
  classification: 'LOCAL_ONLY',
  trust: 'DATA_ONLY',
  windows: [
    {
      handle: '42',
      processId: 100,
      processName: 'notepad.exe',
      title: 'Notes',
      bounds: { x: 10, y: 10, width: 500, height: 400 },
      monitorId: 'DISPLAY1',
      dpi: 96,
      visible: true,
      enabled: true,
      foreground: true,
    },
  ],
};

const action: DesktopAction = {
  id: 'write-note',
  kind: 'UIA_SET_VALUE',
  channel: 'UIA',
  applicationKey: 'notepad',
  expectedWindow: { handle: '42', processId: 100 },
  selector: { automationId: 'TextEditor', controlType: 'Edit' },
  value: 'Bonjour',
  risk: 'MEDIUM',
  verification: { kind: 'UIA', expected: 'value=Bonjour' },
};

function setup(overrides: Partial<DesktopDriver> = {}) {
  const driver: DesktopDriver = {
    observe: vi.fn(async () => observation),
    perform: vi.fn(async () => ({ reference: 'receipt-1', changed: true, detail: {} })),
    verify: vi.fn(async () => ({ passed: true, evidence: ['uia:value=Bonjour'] })),
    ...overrides,
  };
  const audit = { record: vi.fn(async () => undefined) };
  const emergency = new EmergencyStopLatch();
  const core = new ComputerUseCore(
    driver,
    { authorize: vi.fn(async () => true) },
    { evaluate: vi.fn(async () => 'REQUIRE_APPROVAL' as const) },
    audit,
    new UiLeaseManager(() => 1_000),
    emergency,
  );
  return { core, driver, audit, emergency };
}

describe('ComputerUseCore', () => {
  it('executes and verifies an approved semantic UIA action', async () => {
    const values = setup();
    const approvalActionHash = hashDesktopAction('mission-1', action);
    const result = await values.core.execute({
      missionId: 'mission-1',
      action,
      approvalActionHash,
    });
    expect(result.evidence).toEqual(['uia:value=Bonjour']);
    expect(values.driver.perform).toHaveBeenCalledOnce();
    expect(values.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMPUTER_USE_ACTION_VERIFIED',
        actionHash: result.actionHash,
      }),
    );
  });

  it('refuses input when another window is in the foreground', async () => {
    const values = setup({
      observe: vi.fn(async () => ({ ...observation, foregroundHandle: 'other' })),
    });
    await expect(
      values.core.execute({
        missionId: 'mission-1',
        action,
        approvalActionHash: hashDesktopAction('mission-1', action),
      }),
    ).rejects.toThrow('unexpected_foreground_window');
    expect(values.driver.perform).not.toHaveBeenCalled();
  });

  it('requires an approval bound to the exact action hash', async () => {
    const values = setup();
    await expect(
      values.core.execute({ missionId: 'mission-1', action, approvalActionHash: 'wrong' }),
    ).rejects.toThrow('exact_approval_required');
  });

  it('blocks all new actions after an emergency stop', async () => {
    const values = setup();
    values.emergency.stop('user_request');
    await expect(values.core.execute({ missionId: 'mission-1', action })).rejects.toThrow(
      'emergency_stop:user_request',
    );
  });

  it('propagates an emergency stop to an action already in flight', async () => {
    const stop = vi.fn();
    const values = setup({
      perform: vi.fn(async ({ signal }) => {
        stop();
        expect(signal.aborted).toBe(true);
        throw signal.reason;
      }),
    });
    stop.mockImplementation(() => values.emergency.stop('operator_interrupt'));
    await expect(
      values.core.execute({
        missionId: 'mission-1',
        action,
        approvalActionHash: hashDesktopAction('mission-1', action),
      }),
    ).rejects.toThrow('emergency_stop:operator_interrupt');
  });
});

describe('UiLeaseManager', () => {
  it('allows only one mission to own the UI resource', () => {
    const leases = new UiLeaseManager(() => 100);
    leases.acquire('mission-a', 1_000);
    expect(() => leases.acquire('mission-b', 1_000)).toThrow('ui_resource_busy');
  });
});
