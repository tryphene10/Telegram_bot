import { realpath } from 'node:fs/promises';
import { win32 } from 'node:path';
import type { ProjectManifest } from './project-manifest.js';

export type PathOperation = 'READ' | 'WRITE';

export class PathAccessDeniedError extends Error {
  constructor(readonly reason: string) {
    super(`Path access denied: ${reason}`);
    this.name = 'PathAccessDeniedError';
  }
}

export type PathCanonicalizer = (path: string) => Promise<string>;

export async function canonicalizeWindowsPath(path: string): Promise<string> {
  const normalized = win32.resolve(path);
  if (
    normalized.startsWith('\\\\') ||
    normalized.startsWith('\\\\?\\') ||
    normalized.startsWith('\\\\.\\')
  ) {
    throw new PathAccessDeniedError('network_or_device_path');
  }
  try {
    return win32.normalize(await realpath(normalized));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new PathAccessDeniedError('canonicalization_failed');
    }
    const parent = win32.dirname(normalized);
    if (parent === normalized) throw new PathAccessDeniedError('canonicalization_failed');
    return win32.join(await canonicalizeWindowsPath(parent), win32.basename(normalized));
  }
}

function normalizedRelative(value: string): string {
  const normalized = win32.normalize(value).replace(/^\.\\/u, '').toLowerCase();
  return normalized === '.' ? '' : normalized;
}

function matches(relative: string, rule: string): boolean {
  const normalizedRule = normalizedRelative(rule);
  return (
    normalizedRule === '' ||
    relative === normalizedRule ||
    relative.startsWith(`${normalizedRule}\\`)
  );
}

function isSensitive(relative: string): boolean {
  const segments = relative.split('\\');
  if (segments.some((segment) => ['.ssh', '.gnupg', '.aws', '.azure'].includes(segment))) {
    return true;
  }
  const sensitiveFiles = ['id_rsa', 'id_ed25519', 'login data', 'credentials'];
  if (segments.some((segment) => sensitiveFiles.includes(segment))) return true;
  return (
    relative.includes('appdata\\local\\google\\chrome\\user data') ||
    relative.includes('appdata\\local\\microsoft\\edge\\user data') ||
    relative.includes('appdata\\roaming\\microsoft\\credentials') ||
    relative.includes('windows\\system32\\config')
  );
}

export interface AuthorizedPath {
  readonly canonicalRoot: string;
  readonly canonicalPath: string;
  readonly relativePath: string;
}

export class ProjectPathGuard {
  constructor(private readonly canonicalize: PathCanonicalizer = canonicalizeWindowsPath) {}

  async authorize(
    manifest: ProjectManifest,
    requestedPath: string,
    operation: PathOperation,
  ): Promise<AuthorizedPath> {
    if (
      requestedPath.startsWith('\\\\') ||
      requestedPath.startsWith('\\\\?\\') ||
      requestedPath.startsWith('\\\\.\\')
    ) {
      throw new PathAccessDeniedError('network_or_device_path');
    }
    const root = await this.canonicalize(manifest.rootPath);
    const candidateInput = win32.isAbsolute(requestedPath)
      ? requestedPath
      : win32.join(root, requestedPath);
    const candidate = await this.canonicalize(candidateInput);
    const relativeRaw = win32.relative(root, candidate);
    if (relativeRaw.startsWith('..') || win32.isAbsolute(relativeRaw)) {
      throw new PathAccessDeniedError('outside_project_root');
    }
    const relative = normalizedRelative(relativeRaw);
    if (isSensitive(relative)) throw new PathAccessDeniedError('sensitive_path');
    if (!manifest.allowedPaths.some((rule) => matches(relative, rule))) {
      throw new PathAccessDeniedError('path_not_allowlisted');
    }
    if (manifest.deniedPaths.some((rule) => matches(relative, rule))) {
      throw new PathAccessDeniedError('path_denied_by_manifest');
    }
    if (operation === 'WRITE' && manifest.protectedFiles.some((rule) => matches(relative, rule))) {
      throw new PathAccessDeniedError('protected_file');
    }
    return { canonicalRoot: root, canonicalPath: candidate, relativePath: relative };
  }
}
