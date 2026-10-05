import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KnowledgeAdministrationService,
  LocalDerivedKnowledgeArtifactStore,
} from './administration.js';

describe('KnowledgeAdministrationService', () => {
  it('requires one strong confirmation then purges database and derived files with an audit report', async () => {
    const store = {
      enqueueReindex: vi.fn(),
      enqueueProjectReindex: vi.fn(),
      runRetention: vi.fn(),
      purgeProject: vi.fn(async () => ({
        sources: 2,
        chunks: 4,
        embeddings: 4,
        entries: 1,
        jobs: 1,
        tombstoneId: 't-1',
        purgeDigest: 'a'.repeat(64),
      })),
    };
    const artifacts = { purgeProject: vi.fn(async () => ({ files: 3, bytes: 900 })) };
    const authorization = { consume: vi.fn(async () => true) };
    const audit = { record: vi.fn(async () => undefined) };
    const service = new KnowledgeAdministrationService(store, artifacts, authorization, audit);
    await expect(
      service.purgeProject('project-1', 'user request', 'approval-1'),
    ).resolves.toMatchObject({
      sources: 2,
      derivedFiles: 3,
      derivedBytes: 900,
    });
    expect(authorization.consume).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'KNOWLEDGE_PROJECT_PURGED' }),
    );
  });

  it('does not delete anything when strong confirmation is absent', async () => {
    const store = {
      enqueueReindex: vi.fn(),
      enqueueProjectReindex: vi.fn(),
      purgeProject: vi.fn(),
      runRetention: vi.fn(),
    };
    const artifacts = { purgeProject: vi.fn() };
    const service = new KnowledgeAdministrationService(
      store,
      artifacts,
      { consume: vi.fn(async () => false) },
      { record: vi.fn() },
    );
    await expect(service.purgeProject('project-1', 'request', 'bad')).rejects.toMatchObject({
      reason: 'strong_confirmation_required',
    });
    expect(store.purgeProject).not.toHaveBeenCalled();
    expect(artifacts.purgeProject).not.toHaveBeenCalled();
  });

  it('purges only the exact confined derived-artifact directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcc-derived-'));
    await mkdir(join(root, 'project-1'));
    await writeFile(join(root, 'project-1', 'vector.bin'), '1234');
    const store = new LocalDerivedKnowledgeArtifactStore(root);
    await expect(store.purgeProject('project-1')).resolves.toEqual({ files: 1, bytes: 4 });
    await expect(stat(root)).resolves.toBeDefined();
    await expect(store.purgeProject('../escape')).rejects.toMatchObject({
      reason: 'invalid_project_artifact_key',
    });
    await rm(root, { recursive: true, force: true });
  });
});
