import { describe, expect, it } from 'vitest';
import {
  assertCommitBinding,
  assertGitPathsExplicit,
  createGitBaseline,
  hashGitDiff,
  parseGitStatusPorcelainV1Z,
  validateCommitMessage,
  validateGitReference,
} from './git-guard.js';

describe('Git guard', () => {
  it('parses stable zero-delimited status including renames', () => {
    expect(parseGitStatusPorcelainV1Z(' M src/a.ts\0R  src/new.ts\0src/old.ts\0')).toEqual([
      { path: 'src/a.ts', index: ' ', worktree: 'M' },
      { path: 'src/new.ts', originalPath: 'src/old.ts', index: 'R', worktree: ' ' },
    ]);
  });

  it('requires explicit inclusion of changes present before the mission', () => {
    const baseline = createGitBaseline(' M user.txt\0?? new.txt\0');
    expect(() => assertGitPathsExplicit(baseline, ['user.txt'])).toThrow(
      'preexisting_change_requires_explicit_inclusion',
    );
    expect(assertGitPathsExplicit(baseline, ['user.txt'], ['user.txt'])).toEqual(['user.txt']);
    expect(() => assertGitPathsExplicit(baseline, ['clean.txt'], ['user.txt'])).toThrow(
      'invalid_preexisting_inclusion',
    );
  });

  it('invalidates a commit when the staged diff changes', () => {
    const tests = [
      { commandHash: 'a'.repeat(64), exitCode: 0, completedAt: new Date().toISOString() },
    ];
    expect(() => assertCommitBinding('diff-a', hashGitDiff('diff-b'), tests)).toThrow(
      'approved_diff_changed',
    );
    expect(() => assertCommitBinding('diff-a', hashGitDiff('diff-a'), tests)).not.toThrow();
  });

  it('requires successful test evidence before commit', () => {
    expect(() => assertCommitBinding('diff', hashGitDiff('diff'), [])).toThrow(
      'passing_tests_required',
    );
  });

  it('rejects option injection and unsafe references or messages', () => {
    for (const reference of ['--force', '../main', 'main..evil', 'feature name', 'x@{1}']) {
      expect(() => validateGitReference(reference)).toThrow();
    }
    expect(validateGitReference('feature/safe-name')).toBe('feature/safe-name');
    expect(() => validateCommitMessage('subject\n--amend')).toThrow();
  });
});
