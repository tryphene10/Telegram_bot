import { randomUUID } from 'node:crypto';

export type ProjectLockMode = 'READ' | 'WRITE';

export interface ProjectLock {
  readonly token: string;
  readonly projectId: string;
  readonly mode: ProjectLockMode;
  readonly ownerId: string;
  readonly expiresAt: number;
}

export class ProjectLockConflictError extends Error {
  constructor() {
    super('Project lock conflicts with an active operation');
    this.name = 'ProjectLockConflictError';
  }
}

export class ProjectLockManager {
  private readonly locks = new Map<string, ProjectLock[]>();

  constructor(private readonly now: () => number = Date.now) {}

  acquire(
    projectId: string,
    ownerId: string,
    mode: ProjectLockMode,
    lifetimeMs = 60_000,
  ): ProjectLock {
    const active = (this.locks.get(projectId) ?? []).filter((lock) => lock.expiresAt > this.now());
    const conflict = active.some(
      (lock) => lock.ownerId !== ownerId && (lock.mode === 'WRITE' || mode === 'WRITE'),
    );
    if (conflict) throw new ProjectLockConflictError();
    const lock: ProjectLock = {
      token: randomUUID(),
      projectId,
      ownerId,
      mode,
      expiresAt: this.now() + lifetimeMs,
    };
    this.locks.set(projectId, [...active, lock]);
    return lock;
  }

  release(token: string): void {
    for (const [projectId, locks] of this.locks) {
      const remaining = locks.filter((lock) => lock.token !== token);
      if (remaining.length !== locks.length) {
        if (remaining.length === 0) this.locks.delete(projectId);
        else this.locks.set(projectId, remaining);
        return;
      }
    }
    throw new Error('Project lock is unknown or already released');
  }
}

export class ProjectRevisionConflictError extends Error {
  constructor() {
    super('Project revision changed concurrently');
    this.name = 'ProjectRevisionConflictError';
  }
}

export function assertProjectRevision(expected: number, actual: number): void {
  if (!Number.isSafeInteger(expected) || expected < 1 || expected !== actual) {
    throw new ProjectRevisionConflictError();
  }
}
