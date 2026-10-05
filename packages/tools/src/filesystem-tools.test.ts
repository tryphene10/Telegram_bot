import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalFileTools } from './filesystem-tools.js';
import type { ProjectManifest } from './project-manifest.js';

describe('LocalFileTools', () => {
  let root: string;
  let tools: LocalFileTools;
  const audit = { record: vi.fn(async () => undefined) };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'arcc-files-'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'a.txt'), 'hello\nneedle here\n');
    const manifest: ProjectManifest = {
      version: 1,
      projectId: 'p',
      machineId: 'm',
      rootPath: win32.normalize(root),
      stack: [],
      environments: ['LOCAL'],
      commands: {},
      allowedPaths: ['src'],
      deniedPaths: ['src/denied'],
      protectedFiles: ['src/protected.txt'],
      directoryLimits: {},
    };
    tools = new LocalFileTools(manifest, audit);
    audit.record.mockClear();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads, lists and searches only authorized project content', async () => {
    await expect(tools.read('src/a.txt', 100)).resolves.toMatchObject({ bytes: 18 });
    await expect(tools.list('src', 10)).resolves.toEqual([
      expect.objectContaining({ path: 'src\\a.txt', type: 'FILE' }),
    ]);
    await expect(
      tools.search('src', 'needle', { maxFiles: 5, maxResults: 5, maxFileBytes: 100 }),
    ).resolves.toEqual([{ path: 'src\\a.txt', line: 2, preview: 'needle here' }]);
    await expect(tools.read('src/denied/secret.txt', 100)).rejects.toMatchObject({
      reason: 'path_denied_by_manifest',
    });
  });

  it('writes atomically and can roll back replacement and creation', async () => {
    const replaced = await tools.write('src/a.txt', 'changed', 100);
    expect(await readFile(join(root, 'src', 'a.txt'), 'utf8')).toBe('changed');
    await tools.rollback(replaced.rollbackToken!);
    expect(await readFile(join(root, 'src', 'a.txt'), 'utf8')).toContain('hello');
    const created = await tools.write('src/new.txt', 'new', 100);
    await tools.rollback(created.rollbackToken!);
    await expect(stat(join(root, 'src', 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('copies, moves and removes through recoverable paths', async () => {
    const copied = await tools.copy('src/a.txt', 'src/b.txt', 100);
    expect(await readFile(join(root, 'src', 'b.txt'), 'utf8')).toContain('needle');
    await tools.rollback(copied.rollbackToken!);
    const moved = await tools.move('src/a.txt', 'src/moved.txt');
    await tools.rollback(moved.rollbackToken!);
    expect(await readFile(join(root, 'src', 'a.txt'), 'utf8')).toContain('hello');
    const removed = await tools.removeRecoverably('src/a.txt');
    await expect(stat(join(root, 'src', 'a.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await tools.rollback(removed.rollbackToken);
    expect(await readFile(join(root, 'src', 'a.txt'), 'utf8')).toContain('hello');
  });

  it('enforces byte, output and protected-path limits', async () => {
    await expect(tools.read('src/a.txt', 2)).rejects.toMatchObject({ reason: 'file_too_large' });
    await expect(tools.write('src/b.txt', 'large', 2)).rejects.toMatchObject({
      reason: 'content_too_large',
    });
    await expect(tools.list('src', 0)).rejects.toMatchObject({ reason: 'entry_limit' });
    await expect(tools.write('src/protected.txt', 'x', 10)).rejects.toMatchObject({
      reason: 'protected_file',
    });
  });
});
