import { describe, expect, it, vi } from 'vitest';
import { KnowledgeFreshnessService, KnowledgeIndexWorker } from './freshness.js';

const source = {
  id: 'source-1',
  projectId: 'project-1',
  canonicalPath: 'C:\\project\\README.md',
  sha256: 'a'.repeat(64),
  sizeBytes: 3,
  modifiedAt: '2026-10-01T00:00:00.000Z',
  gitHead: 'b'.repeat(40),
  gitDirty: false,
};

describe('KnowledgeFreshnessService', () => {
  it('marks stale and enqueues one incremental job after file or HEAD changes', async () => {
    const mutations = {
      markStale: vi.fn(async () => undefined),
      markDeleted: vi.fn(async () => undefined),
      enqueueReindex: vi.fn(async () => undefined),
    };
    const service = new KnowledgeFreshnessService(
      {
        observe: vi.fn(async () => ({
          exists: true,
          bytes: new TextEncoder().encode('new'),
          sizeBytes: 3,
          modifiedAt: '2026-10-02T00:00:00.000Z',
        })),
        git: vi.fn(async () => ({ head: 'c'.repeat(40), dirty: true })),
      },
      mutations,
    );
    await expect(service.inspect(source)).resolves.toBe('STALE');
    expect(mutations.markStale).toHaveBeenCalledWith(
      'source-1',
      expect.stringContaining('mtime_changed'),
    );
    expect(mutations.enqueueReindex).toHaveBeenCalledOnce();
  });

  it('invalidates citations when a source disappears', async () => {
    const mutations = {
      markStale: vi.fn(),
      markDeleted: vi.fn(async () => undefined),
      enqueueReindex: vi.fn(),
    };
    const service = new KnowledgeFreshnessService(
      { observe: vi.fn(async () => ({ exists: false })), git: vi.fn() },
      mutations,
    );
    await expect(service.inspect(source)).resolves.toBe('DELETED');
    expect(mutations.markDeleted).toHaveBeenCalledWith('source-1', 'source_missing');
    expect(mutations.enqueueReindex).not.toHaveBeenCalled();
  });
});

describe('KnowledgeIndexWorker', () => {
  it('recovers and resumes an interrupted job without creating a duplicate', async () => {
    const store = {
      recoverExpired: vi.fn(async () => 1),
      claim: vi.fn(async () => ({
        id: 'job-1',
        projectId: 'project-1',
        sourceId: 'source-1',
        jobKey: 'source-1:a',
        attempts: 2,
      })),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    };
    const handler = { run: vi.fn(async () => ({ chunks: 2, milliseconds: 5 })) };
    const worker = new KnowledgeIndexWorker(store, handler);
    await expect(worker.tick('worker-1')).resolves.toBe('COMPLETED');
    expect(store.recoverExpired).toHaveBeenCalledOnce();
    expect(handler.run).toHaveBeenCalledOnce();
    expect(store.complete).toHaveBeenCalledWith('job-1', 'worker-1', {
      chunks: 2,
      milliseconds: 5,
    });
  });
});
