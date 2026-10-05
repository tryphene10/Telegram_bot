import { createHash } from 'node:crypto';
import { isAbsolute, win32 } from 'node:path';

export interface GitStatusEntry {
  readonly path: string;
  readonly originalPath?: string;
  readonly index: string;
  readonly worktree: string;
}

export interface GitWorkspaceBaseline {
  readonly entries: readonly GitStatusEntry[];
  readonly hash: string;
}

export interface GitTestEvidence {
  readonly commandHash: string;
  readonly exitCode: number;
  readonly completedAt: string;
}

export class GitGuardError extends Error {
  constructor(readonly reason: string) {
    super(`Git operation denied: ${reason}`);
    this.name = 'GitGuardError';
  }
}

function canonicalPath(path: string): string {
  const normalized = win32.normalize(path).replaceAll('\\', '/');
  if (
    !path ||
    path.length > 1_024 ||
    isAbsolute(path) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    /[\0\r\n]/u.test(path)
  ) {
    throw new GitGuardError('unsafe_path');
  }
  return normalized.replace(/^\.\//u, '');
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function parseGitStatusPorcelainV1Z(output: string): readonly GitStatusEntry[] {
  const records = output.split('\0');
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') throw new GitGuardError('invalid_status_output');
    const status = record.slice(0, 2);
    const path = canonicalPath(record.slice(3));
    const indexStatus = status.charAt(0);
    const worktreeStatus = status.charAt(1);
    if (indexStatus === 'R' || indexStatus === 'C') {
      const original = records[index + 1];
      if (!original) throw new GitGuardError('invalid_rename_output');
      index += 1;
      entries.push({
        path,
        originalPath: canonicalPath(original),
        index: indexStatus,
        worktree: worktreeStatus,
      });
    } else {
      entries.push({ path, index: indexStatus, worktree: worktreeStatus });
    }
  }
  return entries;
}

export function createGitBaseline(statusOutput: string): GitWorkspaceBaseline {
  const entries = [...parseGitStatusPorcelainV1Z(statusOutput)].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  return { entries, hash: hash(JSON.stringify(entries)) };
}

export function assertGitPathsExplicit(
  baseline: GitWorkspaceBaseline,
  requestedPaths: readonly string[],
  explicitlyIncludedPreexisting: readonly string[] = [],
): readonly string[] {
  if (requestedPaths.length === 0 || new Set(requestedPaths).size !== requestedPaths.length) {
    throw new GitGuardError('paths_required_or_duplicated');
  }
  const requested = requestedPaths.map(canonicalPath);
  const explicit = new Set(explicitlyIncludedPreexisting.map(canonicalPath));
  const preexisting = new Set(
    baseline.entries.flatMap(
      (entry) => [entry.path, entry.originalPath].filter(Boolean) as string[],
    ),
  );
  for (const path of requested) {
    if (preexisting.has(path) && !explicit.has(path)) {
      throw new GitGuardError('preexisting_change_requires_explicit_inclusion');
    }
  }
  for (const path of explicit) {
    if (!requested.includes(path) || !preexisting.has(path)) {
      throw new GitGuardError('invalid_preexisting_inclusion');
    }
  }
  return requested;
}

export function hashGitDiff(diff: string): string {
  return hash(diff);
}

export function assertCommitBinding(
  stagedDiff: string,
  expectedDiffHash: string,
  tests: readonly GitTestEvidence[],
): void {
  if (!/^[a-f0-9]{64}$/u.test(expectedDiffHash) || hashGitDiff(stagedDiff) !== expectedDiffHash) {
    throw new GitGuardError('approved_diff_changed');
  }
  if (
    tests.length === 0 ||
    tests.some(
      (test) =>
        !/^[a-f0-9]{64}$/u.test(test.commandHash) ||
        test.exitCode !== 0 ||
        !Number.isFinite(Date.parse(test.completedAt)),
    )
  ) {
    throw new GitGuardError('passing_tests_required');
  }
}

export function validateGitReference(reference: string): string {
  if (
    !reference ||
    reference.length > 255 ||
    reference.startsWith('-') ||
    /[\s~^:?*[\\\0]/u.test(reference) ||
    reference.includes('..') ||
    reference.includes('@{') ||
    reference.endsWith('.') ||
    reference.endsWith('/') ||
    reference.includes('//')
  ) {
    throw new GitGuardError('invalid_reference');
  }
  return reference;
}

export function validateCommitMessage(message: string): string {
  if (!message.trim() || message.length > 2_000 || /[\0\r\n]/u.test(message)) {
    throw new GitGuardError('invalid_commit_message');
  }
  return message;
}
