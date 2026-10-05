import { execFile } from 'node:child_process';
import { arch, cpus, freemem, platform, release, totalmem, uptime } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface SafeSystemInfo {
  readonly platform: string;
  readonly release: string;
  readonly architecture: string;
  readonly cpuLogicalCount: number;
  readonly memoryTotalBytes: number;
  readonly memoryFreeBytes: number;
  readonly uptimeSeconds: number;
}

export interface SafeProcessInfo {
  readonly imageName: string;
  readonly processId: number;
  readonly memoryBytes: number;
}

export function collectSafeSystemInfo(): SafeSystemInfo {
  return {
    platform: platform(),
    release: release(),
    architecture: arch(),
    cpuLogicalCount: cpus().length,
    memoryTotalBytes: totalmem(),
    memoryFreeBytes: freemem(),
    uptimeSeconds: Math.floor(uptime()),
  };
}

function csvFields(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else current += character;
  }
  fields.push(current);
  return fields;
}

export function parseWindowsTaskList(
  output: string,
  maxProcesses: number,
): readonly SafeProcessInfo[] {
  const result: SafeProcessInfo[] = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!line.trim() || result.length >= maxProcesses) continue;
    const fields = csvFields(line);
    if (fields.length < 5) continue;
    const processId = Number(fields[1]);
    const memoryKilobytes = Number(fields[4]!.replace(/[^0-9]/gu, ''));
    if (!Number.isSafeInteger(processId) || processId < 0 || !Number.isFinite(memoryKilobytes))
      continue;
    result.push({
      imageName: fields[0]!.slice(0, 260),
      processId,
      memoryBytes: memoryKilobytes * 1024,
    });
  }
  return result;
}

export async function listSafeWindowsProcesses(
  maxProcesses = 500,
): Promise<readonly SafeProcessInfo[]> {
  if (process.platform !== 'win32') throw new Error('windows_only');
  if (!Number.isSafeInteger(maxProcesses) || maxProcesses < 1 || maxProcesses > 2_000)
    throw new Error('invalid_process_limit');
  const { stdout } = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024,
    encoding: 'utf8',
  });
  return parseWindowsTaskList(stdout, maxProcesses);
}
