import { isAbsolute, win32 } from 'node:path';

export const PROJECT_MANIFEST_VERSION = 1 as const;

export interface ProjectCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly environmentAllowlist?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly network?: 'DENY' | 'ALLOW';
  readonly mutatesProject?: boolean;
  readonly kind?: 'NORMAL' | 'DEPENDENCY_INSTALL' | 'PERSISTENT_PROCESS';
}

export interface DirectoryLimit {
  readonly maxFiles: number;
  readonly maxBytes: number;
}

export interface ProjectManifest {
  readonly version: typeof PROJECT_MANIFEST_VERSION;
  readonly projectId: string;
  readonly machineId: string;
  readonly rootPath: string;
  readonly stack: readonly string[];
  readonly environments: readonly string[];
  readonly commands: Readonly<Record<string, ProjectCommand>>;
  readonly allowedPaths: readonly string[];
  readonly deniedPaths: readonly string[];
  readonly protectedFiles: readonly string[];
  readonly directoryLimits: Readonly<Record<string, DirectoryLimit>>;
}

export class InvalidProjectManifestError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid project manifest: ${reasons.join(', ')}`);
    this.name = 'InvalidProjectManifestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !isAbsolute(value) &&
    !value.startsWith('\\\\') &&
    !win32.normalize(value).split(win32.sep).includes('..')
  );
}

export function validateProjectManifest(value: unknown): ProjectManifest {
  const reasons: string[] = [];
  if (!isRecord(value)) throw new InvalidProjectManifestError(['manifest_not_object']);
  if (value.version !== PROJECT_MANIFEST_VERSION) reasons.push('unsupported_version');
  if (typeof value.projectId !== 'string' || !value.projectId) reasons.push('project_id_required');
  if (typeof value.machineId !== 'string' || !value.machineId) reasons.push('machine_id_required');
  if (
    typeof value.rootPath !== 'string' ||
    !win32.isAbsolute(value.rootPath) ||
    value.rootPath.startsWith('\\\\')
  ) {
    reasons.push('absolute_local_root_required');
  }
  for (const field of ['stack', 'environments', 'allowedPaths', 'deniedPaths', 'protectedFiles']) {
    if (
      !Array.isArray(value[field]) ||
      !(value[field] as unknown[]).every((item) => typeof item === 'string')
    ) {
      reasons.push(`${field}_invalid`);
    }
  }
  for (const field of ['allowedPaths', 'deniedPaths', 'protectedFiles']) {
    if (Array.isArray(value[field]) && !(value[field] as unknown[]).every(safeRelativePath)) {
      reasons.push(`${field}_unsafe`);
    }
  }
  if (!isRecord(value.commands)) {
    reasons.push('commands_invalid');
  } else {
    for (const command of Object.values(value.commands)) {
      if (
        !isRecord(command) ||
        typeof command.executable !== 'string' ||
        !Array.isArray(command.args) ||
        !command.args.every((argument) => typeof argument === 'string') ||
        !safeRelativePath(command.workingDirectory) ||
        (command.environmentAllowlist !== undefined &&
          (!Array.isArray(command.environmentAllowlist) ||
            !command.environmentAllowlist.every(
              (name) => typeof name === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(name),
            ))) ||
        (command.timeoutMs !== undefined &&
          (typeof command.timeoutMs !== 'number' ||
            !Number.isSafeInteger(command.timeoutMs) ||
            command.timeoutMs < 1 ||
            command.timeoutMs > 900_000)) ||
        (command.maxOutputBytes !== undefined &&
          (typeof command.maxOutputBytes !== 'number' ||
            !Number.isSafeInteger(command.maxOutputBytes) ||
            command.maxOutputBytes < 1 ||
            command.maxOutputBytes > 10 * 1024 * 1024)) ||
        (command.network !== undefined &&
          (typeof command.network !== 'string' || !['DENY', 'ALLOW'].includes(command.network))) ||
        (command.mutatesProject !== undefined && typeof command.mutatesProject !== 'boolean') ||
        (command.kind !== undefined &&
          (typeof command.kind !== 'string' ||
            !['NORMAL', 'DEPENDENCY_INSTALL', 'PERSISTENT_PROCESS'].includes(command.kind)))
      ) {
        reasons.push('command_invalid');
        break;
      }
    }
  }
  if (!isRecord(value.directoryLimits)) {
    reasons.push('directory_limits_invalid');
  } else {
    for (const [path, limit] of Object.entries(value.directoryLimits)) {
      if (
        !safeRelativePath(path) ||
        !isRecord(limit) ||
        !Number.isSafeInteger(limit.maxFiles) ||
        (limit.maxFiles as number) < 1 ||
        !Number.isSafeInteger(limit.maxBytes) ||
        (limit.maxBytes as number) < 1
      ) {
        reasons.push('directory_limit_invalid');
        break;
      }
    }
  }
  if (reasons.length > 0) throw new InvalidProjectManifestError(reasons);
  return value as unknown as ProjectManifest;
}

export interface StackSuggestion {
  readonly stack: string;
  readonly evidence: string;
}

export function suggestStack(fileNames: readonly string[]): readonly StackSuggestion[] {
  const lower = new Set(fileNames.map((file) => file.toLowerCase()));
  const suggestions: StackSuggestion[] = [];
  if (lower.has('package.json')) suggestions.push({ stack: 'nodejs', evidence: 'package.json' });
  if (lower.has('pyproject.toml') || lower.has('requirements.txt')) {
    suggestions.push({
      stack: 'python',
      evidence: lower.has('pyproject.toml') ? 'pyproject.toml' : 'requirements.txt',
    });
  }
  if (lower.has('dockerfile') || lower.has('compose.yml') || lower.has('docker-compose.yml')) {
    suggestions.push({ stack: 'docker', evidence: 'container manifest' });
  }
  return suggestions;
}

export function resolveDirectoryLimit(
  manifest: ProjectManifest,
  relativePath: string,
): DirectoryLimit | null {
  const normalized = win32.normalize(relativePath).toLowerCase();
  const candidates = Object.entries(manifest.directoryLimits)
    .map(([path, limit]) => [win32.normalize(path).toLowerCase(), limit] as const)
    .filter(
      ([path]) =>
        path === '.' || normalized === path || normalized.startsWith(`${path}${win32.sep}`),
    )
    .sort(([left], [right]) => right.length - left.length);
  return candidates[0]?.[1] ?? null;
}
