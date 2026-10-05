import { describe, expect, it } from 'vitest';
import type { ProjectManifest } from './project-manifest.js';
import { ProjectPathGuard } from './path-guard.js';

const manifest: ProjectManifest = {
  version: 1,
  projectId: 'project',
  machineId: 'machine',
  rootPath: 'D:\\Projects\\Safe',
  stack: [],
  environments: ['development'],
  commands: {},
  allowedPaths: ['.'],
  deniedPaths: ['private'],
  protectedFiles: ['.env'],
  directoryLimits: {},
};

describe('ProjectPathGuard', () => {
  const canonicalize = async (path: string) => {
    const normalized = path.replaceAll('/', '\\');
    if (normalized.toLowerCase().includes('link\\escape.txt')) return 'D:\\Outside\\escape.txt';
    return normalized;
  };
  const guard = new ProjectPathGuard(canonicalize);

  it('accepts paths inside the root regardless of Windows casing', async () => {
    await expect(guard.authorize(manifest, 'SRC\\index.ts', 'READ')).resolves.toMatchObject({
      relativePath: 'src\\index.ts',
    });
  });

  it.each(['..\\outside.txt', 'link\\escape.txt'])(
    'blocks traversal or resolved link escape %s',
    async (path) => {
      await expect(guard.authorize(manifest, path, 'READ')).rejects.toThrow('outside_project_root');
    },
  );

  it('applies deny and protected-file rules before tools exist', async () => {
    await expect(guard.authorize(manifest, 'private\\data.txt', 'READ')).rejects.toThrow(
      'path_denied_by_manifest',
    );
    await expect(guard.authorize(manifest, '.env', 'WRITE')).rejects.toThrow('protected_file');
    await expect(guard.authorize(manifest, '.ssh\\id_rsa', 'READ')).rejects.toThrow(
      'sensitive_path',
    );
  });

  it('rejects UNC and device paths by default', async () => {
    await expect(guard.authorize(manifest, '\\\\server\\share\\file', 'READ')).rejects.toThrow(
      'network_or_device_path',
    );
    await expect(guard.authorize(manifest, '\\\\?\\C:\\Windows', 'READ')).rejects.toThrow(
      'network_or_device_path',
    );
  });
});
