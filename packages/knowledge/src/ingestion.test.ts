import { describe, expect, it, vi } from 'vitest';
import { SecretRedactor } from '@arcc/security';
import type { ProjectManifest, ProjectPathGuard } from '@arcc/tools';
import { KnowledgeIngestionError, KnowledgeIngestionService } from './ingestion.js';

const manifest = {
  version: 1,
  projectId: 'project-1',
  machineId: 'machine-1',
  rootPath: 'C:\\project',
  stack: [],
  environments: [],
  commands: {},
  allowedPaths: ['docs', 'README.md'],
  deniedPaths: ['docs\\private'],
  protectedFiles: [],
  directoryLimits: {},
} satisfies ProjectManifest;

function fixture(content: string, path = 'docs\\guide.md') {
  const upsert = vi.fn(async ({ chunks }) => ({
    sourceId: 'source-1',
    inserted: true,
    chunks: chunks.length,
  }));
  const authorize = vi.fn(async () => ({
    canonicalRoot: 'C:\\project',
    canonicalPath: `C:\\project\\${path}`,
    relativePath: path,
  }));
  const bytes = new TextEncoder().encode(content);
  const service = new KnowledgeIngestionService(
    { authorize } as unknown as ProjectPathGuard,
    {
      read: vi.fn(async () => ({
        bytes,
        sizeBytes: bytes.byteLength,
        modifiedAt: '2026-10-01T00:00:00.000Z',
        symbolicLink: false,
      })),
    },
    { upsert },
    { inspect: vi.fn(async () => ({ head: 'a'.repeat(40), dirty: false })) },
    new SecretRedactor(['MEMORY_CANARY']),
    () => new Date('2026-10-01T00:00:01.000Z'),
  );
  return { service, authorize, upsert };
}

describe('KnowledgeIngestionService', () => {
  it('ingests only an authorized local text source idempotently through its store', async () => {
    const values = fixture('# Guide\nVerified fact.');
    await expect(
      values.service.ingest({
        manifest,
        projectId: 'project-1',
        requestedPath: 'docs/guide.md',
        version: 1,
      }),
    ).resolves.toMatchObject({ sourceId: 'source-1', inserted: true, chunks: 1 });
    expect(values.authorize).toHaveBeenCalledWith(manifest, 'docs/guide.md', 'READ');
    expect(values.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ classification: 'LOCAL_ONLY', gitHead: 'a'.repeat(40) }),
        chunks: [expect.objectContaining({ trust: 'DATA_ONLY' })],
      }),
    );
  });

  it.each([
    ['binary', new Uint8Array([0, 1, 2]), 'binary_file_forbidden'],
    ['secret', new TextEncoder().encode('token=MEMORY_CANARY'), 'secret_content_forbidden'],
  ])('rejects %s content', async (_label, bytes, reason) => {
    const values = fixture('safe');
    const service = new KnowledgeIngestionService(
      { authorize: values.authorize } as unknown as ProjectPathGuard,
      {
        read: vi.fn(async () => ({
          bytes,
          sizeBytes: bytes.byteLength,
          modifiedAt: '2026-10-01T00:00:00.000Z',
          symbolicLink: false,
        })),
      },
      { upsert: values.upsert },
      { inspect: vi.fn(async () => ({})) },
      new SecretRedactor(['MEMORY_CANARY']),
    );
    await expect(
      service.ingest({
        manifest,
        projectId: 'project-1',
        requestedPath: 'docs/guide.md',
        version: 1,
      }),
    ).rejects.toMatchObject({ reason });
  });

  it('rejects symlinks, unknown binaries and excessive files', async () => {
    const values = fixture('safe', 'docs\\image.exe');
    await expect(
      values.service.ingest({
        manifest,
        projectId: 'project-1',
        requestedPath: 'docs/image.exe',
        version: 1,
      }),
    ).rejects.toBeInstanceOf(KnowledgeIngestionError);

    const link = fixture('safe');
    const bytes = new TextEncoder().encode('safe');
    const service = new KnowledgeIngestionService(
      { authorize: link.authorize } as unknown as ProjectPathGuard,
      {
        read: vi.fn(async () => ({
          bytes,
          sizeBytes: bytes.length,
          modifiedAt: new Date().toISOString(),
          symbolicLink: true,
        })),
      },
      { upsert: link.upsert },
      { inspect: vi.fn(async () => ({})) },
    );
    await expect(
      service.ingest({
        manifest,
        projectId: 'project-1',
        requestedPath: 'docs/guide.md',
        version: 1,
      }),
    ).rejects.toMatchObject({ reason: 'symbolic_link_forbidden' });
    await expect(
      link.service.ingest({
        manifest,
        projectId: 'project-1',
        requestedPath: 'docs/guide.md',
        version: 1,
        maximumBytes: 1,
      }),
    ).rejects.toMatchObject({ reason: 'file_too_large_or_changed' });
  });

  it('refuses protected files even when they are readable in the manifest', async () => {
    const values = fixture('# protected', 'README.md');
    const protectedManifest = { ...manifest, protectedFiles: ['README.md'] };
    await expect(
      values.service.ingest({
        manifest: protectedManifest,
        projectId: 'project-1',
        requestedPath: 'README.md',
        version: 1,
      }),
    ).rejects.toMatchObject({ reason: 'protected_file_forbidden' });
    expect(values.upsert).not.toHaveBeenCalled();
  });
});
