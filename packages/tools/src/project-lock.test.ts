import { describe, expect, it } from 'vitest';
import {
  ProjectLockConflictError,
  ProjectLockManager,
  assertProjectRevision,
} from './project-lock.js';

describe('project concurrency guards', () => {
  it('allows readers and arbitrates incompatible writers', () => {
    const locks = new ProjectLockManager(() => 1_000);
    const first = locks.acquire('project', 'mission-a', 'READ');
    locks.acquire('project', 'mission-b', 'READ');
    expect(() => locks.acquire('project', 'mission-c', 'WRITE')).toThrow(ProjectLockConflictError);
    locks.release(first.token);
  });

  it('lets an expired lock stop blocking work', () => {
    let now = 1_000;
    const locks = new ProjectLockManager(() => now);
    locks.acquire('project', 'mission-a', 'WRITE', 10);
    now = 1_011;
    expect(() => locks.acquire('project', 'mission-b', 'WRITE')).not.toThrow();
  });

  it('rejects stale project revisions', () => {
    expect(() => assertProjectRevision(2, 3)).toThrow('Project revision changed concurrently');
    expect(() => assertProjectRevision(3, 3)).not.toThrow();
  });
});
