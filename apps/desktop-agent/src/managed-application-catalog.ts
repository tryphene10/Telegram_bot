import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import { promisify } from 'node:util';
import type { ApplicationCatalogPort, WindowSnapshot } from './computer-use-core.js';

const execFileAsync = promisify(execFile);

export interface ManagedApplicationDefinition {
  readonly appKey: string;
  readonly executablePath: string;
  readonly executableSha256?: string;
  readonly launchProfile: Readonly<Record<string, unknown>>;
}

export interface ApplicationCatalogSource {
  findEnabled(applicationKey: string): Promise<ManagedApplicationDefinition | undefined>;
}

export interface ProcessIdentity {
  readonly processId: number;
  readonly executablePath: string;
  readonly executableSha256?: string;
}

export interface ProcessIdentityProvider {
  inspect(processId: number, includeSha256: boolean): Promise<ProcessIdentity | undefined>;
}

function normalizedPath(path: string): string {
  return win32.normalize(path).toLocaleLowerCase('en-US');
}

function stringList(value: unknown): readonly string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    return undefined;
  }
  return value;
}

export class ManagedApplicationCatalog implements ApplicationCatalogPort {
  constructor(
    private readonly source: ApplicationCatalogSource,
    private readonly identities: ProcessIdentityProvider,
  ) {}

  async authorize(applicationKey: string, window: WindowSnapshot): Promise<boolean> {
    const application = await this.source.findEnabled(applicationKey);
    if (!application || application.appKey !== applicationKey) return false;
    const identity = await this.identities.inspect(
      window.processId,
      application.executableSha256 !== undefined,
    );
    if (!identity || identity.processId !== window.processId) return false;
    if (normalizedPath(identity.executablePath) !== normalizedPath(application.executablePath)) {
      return false;
    }
    if (
      win32.basename(identity.executablePath).toLocaleLowerCase('en-US') !==
      window.processName.toLocaleLowerCase('en-US')
    ) {
      return false;
    }
    if (
      application.executableSha256 &&
      identity.executableSha256?.toLocaleLowerCase('en-US') !==
        application.executableSha256.toLocaleLowerCase('en-US')
    ) {
      return false;
    }
    const exactTitles = stringList(application.launchProfile.windowTitles);
    const titlePrefixes = stringList(application.launchProfile.windowTitlePrefixes);
    if (!exactTitles || !titlePrefixes) return false;
    if (exactTitles.length === 0 && titlePrefixes.length === 0) return true;
    return (
      exactTitles.includes(window.title) ||
      titlePrefixes.some((prefix) => window.title.startsWith(prefix))
    );
  }
}

export function buildProcessIdentityScript(processId: number, includeSha256: boolean): string {
  if (!Number.isSafeInteger(processId) || processId < 1) throw new Error('invalid_process_id');
  return String.raw`
$ErrorActionPreference='Stop'
$process=Get-CimInstance Win32_Process -Filter 'ProcessId = ${processId}'
if($null -eq $process -or [string]::IsNullOrWhiteSpace($process.ExecutablePath)){ exit 3 }
$hash=$null
if(${includeSha256 ? '$true' : '$false'}){$hash=(Get-FileHash -LiteralPath $process.ExecutablePath -Algorithm SHA256).Hash.ToLowerInvariant()}
[pscustomobject]@{processId=[int]$process.ProcessId;executablePath=$process.ExecutablePath;executableSha256=$hash}|ConvertTo-Json -Compress
`.trim();
}

export class WindowsProcessIdentityProvider implements ProcessIdentityProvider {
  async inspect(processId: number, includeSha256: boolean): Promise<ProcessIdentity | undefined> {
    if (process.platform !== 'win32') throw new Error('windows_only');
    const script = buildProcessIdentityScript(processId, includeSha256);
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 20_000, maxBuffer: 128 * 1024 },
      );
      const value = JSON.parse(stdout.trim()) as {
        processId?: unknown;
        executablePath?: unknown;
        executableSha256?: unknown;
      };
      if (value.processId !== processId || typeof value.executablePath !== 'string')
        return undefined;
      if (
        value.executableSha256 !== null &&
        value.executableSha256 !== undefined &&
        (typeof value.executableSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(value.executableSha256))
      ) {
        return undefined;
      }
      return {
        processId,
        executablePath: value.executablePath,
        ...(typeof value.executableSha256 === 'string'
          ? { executableSha256: value.executableSha256 }
          : {}),
      };
    } catch (error) {
      if ((error as { code?: unknown }).code === 3) return undefined;
      throw error;
    }
  }
}
