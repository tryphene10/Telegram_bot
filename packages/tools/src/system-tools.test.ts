import { describe, expect, it } from 'vitest';
import { collectSafeSystemInfo, parseWindowsTaskList } from './system-tools.js';

describe('safe system tools', () => {
  it('does not expose hostname, environment or command lines', () => {
    const info = collectSafeSystemInfo();
    expect(info.cpuLogicalCount).toBeGreaterThan(0);
    expect(info).not.toHaveProperty('hostname');
    expect(info).not.toHaveProperty('environment');
  });

  it('parses only bounded non-sensitive task fields', () => {
    const values = parseWindowsTaskList(
      '"node.exe","42","Console","1","12,345 K"\r\n"app.exe","43","Console","1","5 K"',
      1,
    );
    expect(values).toEqual([{ imageName: 'node.exe', processId: 42, memoryBytes: 12_345 * 1024 }]);
    expect(values[0]).not.toHaveProperty('commandLine');
    expect(values[0]).not.toHaveProperty('user');
  });
});
