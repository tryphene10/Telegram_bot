import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileEmergencyStopLatch,
  activateEmergencyStop,
  readEmergencyStopState,
  resetEmergencyStop,
} from './file-emergency-stop.js';

const temporaryDirectories: string[] = [];
const latches: FileEmergencyStopLatch[] = [];

async function fixture(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'arcc-emergency-stop-'));
  temporaryDirectories.push(directory);
  return { directory, path: join(directory, 'computer-use.stop.json') };
}

afterEach(async () => {
  for (const latch of latches.splice(0)) latch.close();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('file emergency stop', () => {
  it('activates idempotently and resets through the shared sentinel', async () => {
    const { path } = await fixture();
    expect(await readEmergencyStopState(path)).toEqual({ active: false });

    const first = await activateEmergencyStop(
      path,
      'operator_request',
      () => new Date('2026-10-01T12:00:00.000Z'),
    );
    const second = await activateEmergencyStop(path, 'must_not_replace');
    expect(first).toEqual({
      active: true,
      reason: 'operator_request',
      activatedAt: '2026-10-01T12:00:00.000Z',
    });
    expect(second).toEqual(first);

    await resetEmergencyStop(path);
    expect(await readEmergencyStopState(path)).toEqual({ active: false });
  });

  it('aborts in-flight work when another process creates the sentinel', async () => {
    const { path } = await fixture();
    const latch = new FileEmergencyStopLatch(path, 25);
    latches.push(latch);
    const inFlightSignal = latch.signal;

    await activateEmergencyStop(path, 'external_stop');
    await vi.waitFor(() => expect(inFlightSignal.aborted).toBe(true));
    expect(() => latch.assertRunning()).toThrow('emergency_stop:external_stop');

    await resetEmergencyStop(path);
    await vi.waitFor(() => expect(latch.signal.aborted).toBe(false));
    expect(() => latch.assertRunning()).not.toThrow();
  });

  it('fails closed when the sentinel is malformed', async () => {
    const { path } = await fixture();
    await writeFile(path, '{not-json', 'utf8');
    const latch = new FileEmergencyStopLatch(path, 25);
    latches.push(latch);
    expect(() => latch.assertRunning()).toThrow('invalid_emergency_stop_file');
  });
});
