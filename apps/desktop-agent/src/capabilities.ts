import { arch, cpus, freemem, hostname, platform, release, totalmem } from 'node:os';

export interface MachineCapabilities {
  readonly hostname: string;
  readonly platform: string;
  readonly release: string;
  readonly architecture: string;
  readonly cpuLogicalCount: number;
  readonly memoryTotalBytes: number;
  readonly memoryFreeBytes: number;
  readonly toolsEnabled: false;
  readonly computerUseAvailable: boolean;
  readonly uiInputEnabledByDefault: false;
}

export function collectMachineCapabilities(): MachineCapabilities {
  return {
    hostname: hostname(),
    platform: platform(),
    release: release(),
    architecture: arch(),
    cpuLogicalCount: cpus().length,
    memoryTotalBytes: totalmem(),
    memoryFreeBytes: freemem(),
    toolsEnabled: false,
    computerUseAvailable: platform() === 'win32',
    uiInputEnabledByDefault: false,
  };
}
