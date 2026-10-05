import { hashGitDiff, type ProjectManifest } from '@arcc/tools';
import { describe, expect, it, vi } from 'vitest';
import { ControlledGitService, type ExactCommandExecutor } from './git-service.js';
import { SecureExactCommandExecutor } from './exact-command-executor.js';
import { SecureTerminalRunner, WindowsProcessController } from './terminal-runner.js';

const manifest = {
  rootPath: 'C:\\project',
  allowedPaths: ['.'],
  deniedPaths: [],
  protectedFiles: [],
} as ProjectManifest;

function harness(outputs: readonly string[] = []) {
  let index = 0;
  const execute = vi.fn(async () => ({
    status: 'COMPLETED' as const,
    exitCode: 0,
    stdout: outputs[index++] ?? '',
    stderr: '',
    outputBytes: 0,
    redactions: 0,
  }));
  const paths = {
    authorize: vi.fn(async (_manifest, path: string) => ({
      canonicalRoot: 'C:\\project',
      canonicalPath: `C:\\project\\${path}`,
      relativePath: path,
    })),
  };
  return {
    execute,
    service: new ControlledGitService(
      manifest,
      'C:\\Program Files\\Git\\cmd\\git.exe',
      { execute } as ExactCommandExecutor,
      paths as never,
    ),
  };
}

describe('ControlledGitService', () => {
  it('uses exact structured read arguments', async () => {
    const { service, execute } = harness(['status']);
    await expect(service.status()).resolves.toBe('status');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['status', '--short', '--branch'] }),
    );
  });

  it('does not stage a preexisting user change silently', async () => {
    const { service, execute } = harness();
    const baseline = {
      entries: [{ path: 'user.txt', index: ' ', worktree: 'M' }],
      hash: 'b'.repeat(64),
    };
    await expect(
      service.stage({ paths: ['user.txt'], baseline, baselineHash: baseline.hash }),
    ).rejects.toThrow('preexisting_change_requires_explicit_inclusion');
    expect(execute).not.toHaveBeenCalled();
    await service.stage({
      paths: ['user.txt'],
      baseline,
      baselineHash: baseline.hash,
      includePreexisting: ['user.txt'],
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['add', '--', 'user.txt'] }),
    );
  });

  it('rechecks the exact staged diff immediately before commit', async () => {
    const { service, execute } = harness(['changed diff']);
    await expect(
      service.commit({
        message: 'safe subject',
        expectedDiffHash: hashGitDiff('approved diff'),
        tests: [
          { commandHash: 'a'.repeat(64), exitCode: 0, completedAt: new Date().toISOString() },
        ],
      }),
    ).rejects.toThrow('approved_diff_changed');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('keeps pull and push as distinct exact operations', async () => {
    const { service, execute } = harness();
    await service.pull('origin', 'main');
    await service.push('origin', 'main');
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      args: ['pull', '--ff-only', 'origin', 'main'],
      network: 'ALLOW',
    });
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      args: ['push', 'origin', 'main'],
      network: 'ALLOW',
    });
  });

  it('confines worktree creation to an authorized path', async () => {
    const { service, execute } = harness();
    await service.addWorktree('.arcc/worktrees/feature', 'feature/safe', true);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          'worktree',
          'add',
          '--checkout',
          '-b',
          'feature/safe',
          '--',
          '.arcc/worktrees/feature',
        ],
      }),
    );
  });

  it.runIf(process.platform === 'win32')(
    'reads the real repository through git.exe without a shell',
    async () => {
      const gitExecutable = execFileSync('where.exe', ['git.exe'], { encoding: 'utf8' })
        .split(/\r?\n/u)
        .find(Boolean);
      expect(gitExecutable).toBeTruthy();
      const runner = new SecureTerminalRunner(
        new WindowsProcessController(),
        new SecretRedactor(),
        { record: vi.fn() },
      );
      const service = new ControlledGitService(
        { ...manifest, rootPath: process.cwd() },
        gitExecutable as string,
        new SecureExactCommandExecutor(runner),
      );
      await expect(service.status()).resolves.toEqual(expect.any(String));
    },
  );
});
import { execFileSync } from 'node:child_process';
import { SecretRedactor } from '@arcc/security';
