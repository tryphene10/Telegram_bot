import { describe, expect, it, vi } from 'vitest';
import { UserActivityMonitor, buildWindowsUserActivityScript } from './windows-user-activity.js';

describe('Windows user activity', () => {
  it('uses the read-only GetLastInputInfo API', () => {
    const script = buildWindowsUserActivityScript();
    expect(script).toContain('GetLastInputInfo');
    expect(script).toContain('IdleMilliseconds');
    expect(script).not.toContain('SendInput');
  });

  it('distinguishes human activity from the automation grace window', async () => {
    let now = 10_000;
    const provider = { sample: vi.fn(async () => ({ capturedAt: 'now', idleMs: 100 })) };
    const monitor = new UserActivityMonitor(provider, 2_000, 750, () => now);
    await expect(monitor.userActivityDetected()).resolves.toBe(true);
    monitor.recordAutomationInput();
    now += 500;
    await expect(monitor.userActivityDetected()).resolves.toBe(false);
    now += 300;
    await expect(monitor.userActivityDetected()).resolves.toBe(true);
  });
});
