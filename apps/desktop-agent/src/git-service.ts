import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import {
  assertCommitBinding,
  assertGitPathsExplicit,
  createGitBaseline,
  type GitTestEvidence,
  type GitWorkspaceBaseline,
  type ProjectManifest,
  ProjectPathGuard,
  validateCommitMessage,
  validateGitReference,
} from '@arcc/tools';
import type { TerminalResult } from './terminal-runner.js';

export interface ExactCommandExecutor {
  execute(input: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
    readonly commandHash: string;
    readonly profile: string;
    readonly network: 'DENY' | 'ALLOW';
    readonly signal?: AbortSignal;
  }): Promise<TerminalResult>;
}

export class GitServiceError extends Error {
  constructor(readonly reason: string) {
    super(`Controlled Git operation failed: ${reason}`);
    this.name = 'GitServiceError';
  }
}

export class ControlledGitService {
  constructor(
    private readonly manifest: ProjectManifest,
    private readonly gitExecutable: string,
    private readonly commands: ExactCommandExecutor,
    private readonly paths = new ProjectPathGuard(),
  ) {
    if (
      !win32.isAbsolute(gitExecutable) ||
      win32.basename(gitExecutable).toLowerCase() !== 'git.exe'
    ) {
      throw new GitServiceError('absolute_git_executable_required');
    }
  }

  async captureBaseline(signal?: AbortSignal): Promise<GitWorkspaceBaseline> {
    return createGitBaseline((await this.run(['status', '--porcelain=v1', '-z'], signal)).stdout);
  }

  async status(signal?: AbortSignal): Promise<string> {
    return (await this.run(['status', '--short', '--branch'], signal)).stdout;
  }

  async diff(
    input: { readonly staged?: boolean; readonly paths?: readonly string[] },
    signal?: AbortSignal,
  ): Promise<string> {
    const paths = await this.authorizePaths(input.paths ?? [], 'READ');
    return (await this.run(['diff', ...(input.staged ? ['--cached'] : []), '--', ...paths], signal))
      .stdout;
  }

  async log(limit = 20, signal?: AbortSignal): Promise<string> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new GitServiceError('invalid_log_limit');
    return (
      await this.run(
        ['log', `-${limit}`, '--date=iso-strict', '--format=%H%x09%ad%x09%an%x09%s'],
        signal,
      )
    ).stdout;
  }

  async branches(signal?: AbortSignal): Promise<string> {
    return (
      await this.run(['branch', '--list', '--format=%(refname:short)%09%(objectname)'], signal)
    ).stdout;
  }

  async worktrees(signal?: AbortSignal): Promise<string> {
    return (await this.run(['worktree', 'list', '--porcelain'], signal)).stdout;
  }

  async addWorktree(
    path: string,
    branch: string,
    create: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const authorized = (await this.authorizePaths([path], 'WRITE'))[0];
    if (!authorized) throw new GitServiceError('worktree_path_required');
    await this.run(
      [
        'worktree',
        'add',
        ...(create ? ['--checkout', '-b', validateGitReference(branch)] : []),
        '--',
        authorized,
        ...(!create ? [validateGitReference(branch)] : []),
      ],
      signal,
    );
  }

  async removeWorktree(path: string, signal?: AbortSignal): Promise<void> {
    const authorized = (await this.authorizePaths([path], 'WRITE'))[0];
    if (!authorized) throw new GitServiceError('worktree_path_required');
    await this.run(['worktree', 'remove', '--', authorized], signal);
  }

  async stage(
    input: {
      readonly paths: readonly string[];
      readonly baseline: GitWorkspaceBaseline;
      readonly baselineHash: string;
      readonly includePreexisting?: readonly string[];
    },
    signal?: AbortSignal,
  ): Promise<void> {
    if (input.baseline.hash !== input.baselineHash)
      throw new GitServiceError('baseline_hash_mismatch');
    const explicit = assertGitPathsExplicit(input.baseline, input.paths, input.includePreexisting);
    const paths = await this.authorizePaths(explicit, 'WRITE');
    await this.run(['add', '--', ...paths], signal);
  }

  async commit(
    input: {
      readonly message: string;
      readonly expectedDiffHash: string;
      readonly tests: readonly GitTestEvidence[];
    },
    signal?: AbortSignal,
  ): Promise<string> {
    const diff = (await this.run(['diff', '--cached', '--binary', '--no-ext-diff'], signal)).stdout;
    assertCommitBinding(diff, input.expectedDiffHash, input.tests);
    const result = await this.run(
      ['commit', '--no-verify', '-m', validateCommitMessage(input.message)],
      signal,
    );
    return result.stdout;
  }

  async switchBranch(branch: string, create: boolean, signal?: AbortSignal): Promise<void> {
    await this.run(
      ['switch', ...(create ? ['--create'] : []), validateGitReference(branch)],
      signal,
    );
  }

  async pull(remote: string, branch: string, signal?: AbortSignal): Promise<void> {
    await this.run(
      ['pull', '--ff-only', validateGitReference(remote), validateGitReference(branch)],
      signal,
      300_000,
    );
  }

  async push(remote: string, branch: string, signal?: AbortSignal): Promise<void> {
    await this.run(
      ['push', validateGitReference(remote), validateGitReference(branch)],
      signal,
      300_000,
    );
  }

  async reset(
    reference: string,
    mode: 'SOFT' | 'MIXED' | 'HARD',
    signal?: AbortSignal,
  ): Promise<void> {
    await this.run(['reset', `--${mode.toLowerCase()}`, validateGitReference(reference)], signal);
  }

  private async authorizePaths(
    paths: readonly string[],
    operation: 'READ' | 'WRITE',
  ): Promise<readonly string[]> {
    return Promise.all(
      paths.map(async (path) =>
        (await this.paths.authorize(this.manifest, path, operation)).relativePath.replaceAll(
          '\\',
          '/',
        ),
      ),
    );
  }

  private async run(
    args: readonly string[],
    signal?: AbortSignal,
    timeoutMs = 120_000,
  ): Promise<TerminalResult> {
    const commandHash = createHash('sha256')
      .update(JSON.stringify({ executable: this.gitExecutable, args, cwd: this.manifest.rootPath }))
      .digest('hex');
    const result = await this.commands.execute({
      executable: this.gitExecutable,
      args,
      cwd: this.manifest.rootPath,
      timeoutMs,
      maxOutputBytes: 10 * 1024 * 1024,
      commandHash,
      profile: `git.${args[0] ?? 'unknown'}`,
      network: ['pull', 'push'].includes(args[0] ?? '') ? 'ALLOW' : 'DENY',
      ...(signal === undefined ? {} : { signal }),
    });
    if (result.exitCode !== 0) throw new GitServiceError('git_exit_nonzero');
    return result;
  }
}
