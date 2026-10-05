import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stdout } from 'node:process';
import { ProjectPathGuard } from '../packages/tools/dist/index.js';
import {
  HybridKnowledgeSearch,
  KnowledgeBenchmark,
  KnowledgeFreshnessService,
  KnowledgeIngestionService,
  LocalEmbeddingService,
  LocalKnowledgeFilePort,
  LocalSemanticSearchService,
} from '../packages/knowledge/dist/index.js';

const root = await mkdtemp(join(tmpdir(), 'arcc-knowledge-'));
try {
  await mkdir(join(root, 'docs'));
  const sourcePath = join(root, 'docs', 'guide.md');
  await writeFile(sourcePath, '# Setup\nUse the verified local configuration.\n');
  const sources = [];
  const store = {
    upsert: async ({ source, chunks }) => {
      const existing = sources.find((item) => item.source.sha256 === source.sha256);
      if (existing)
        return { sourceId: existing.id, inserted: false, chunks: existing.chunks.length };
      const value = { id: `source-${sources.length + 1}`, source, chunks };
      sources.push(value);
      return { sourceId: value.id, inserted: true, chunks: chunks.length };
    },
    lexical: async ({ projectId }) =>
      sources.flatMap(({ id, source, chunks }) =>
        chunks.map((chunk) => ({
          chunkId: `${id}:${chunk.ordinal}`,
          sourceId: id,
          projectId,
          relativePath: source.relativePath,
          section: chunk.section,
          anchor: chunk.anchor,
          sourceHash: source.sha256,
          chunkHash: chunk.sha256,
          version: source.version,
          observedAt: source.observedAt,
          freshness: source.freshness,
          excerpt: chunk.content,
          lexicalScore: 1,
        })),
      ),
    citation: async (sourceId, chunkHash) => {
      const value = sources.find(({ id }) => id === sourceId);
      const chunk = value?.chunks.find(({ sha256 }) => sha256 === chunkHash);
      return value && chunk
        ? {
            chunkId: `${value.id}:${chunk.ordinal}`,
            sourceId: value.id,
            projectId: 'project-1',
            relativePath: value.source.relativePath,
            section: chunk.section,
            anchor: chunk.anchor,
            sourceHash: value.source.sha256,
            chunkHash: chunk.sha256,
            version: value.source.version,
            observedAt: value.source.observedAt,
            freshness: value.source.freshness,
            excerpt: chunk.content,
            lexicalScore: 1,
          }
        : undefined;
    },
  };
  const manifest = {
    version: 1,
    projectId: 'project-1',
    machineId: 'machine-1',
    rootPath: root,
    stack: [],
    environments: [],
    commands: {},
    allowedPaths: ['docs'],
    deniedPaths: [],
    protectedFiles: [],
    directoryLimits: {},
  };
  const ingestion = new KnowledgeIngestionService(
    new ProjectPathGuard(),
    new LocalKnowledgeFilePort(),
    store,
    { inspect: async () => ({ head: 'a'.repeat(40), dirty: false }) },
  );
  const ingested = await ingestion.ingest({
    manifest,
    projectId: 'project-1',
    requestedPath: 'docs/guide.md',
    version: 1,
  });
  const duplicate = await ingestion.ingest({
    manifest,
    projectId: 'project-1',
    requestedPath: 'docs/guide.md',
    version: 1,
  });
  assert.equal(ingested.inserted, true);
  assert.equal(duplicate.inserted, false);

  const search = new HybridKnowledgeSearch(store);
  const response = await search.search({ projectId: 'project-1', query: 'verified configuration' });
  assert.equal(response.mode, 'LEXICAL_ONLY');
  assert.equal(response.results.length, 1);
  assert.equal(
    (await search.getCitation(response.results[0].citation.uri)).sourceHash,
    ingested.sha256,
  );

  const metadata = await stat(sourcePath);
  await writeFile(sourcePath, '# Setup\nChanged configuration.\n');
  const stale = [];
  const freshness = new KnowledgeFreshnessService(
    {
      observe: async (path) => {
        const current = await stat(path);
        return {
          exists: true,
          bytes: await readFile(path),
          sizeBytes: current.size,
          modifiedAt: current.mtime.toISOString(),
        };
      },
      git: async () => ({ head: 'b'.repeat(40), dirty: true }),
    },
    {
      markStale: async (_id, reason) => stale.push(reason),
      markDeleted: async () => undefined,
      enqueueReindex: async () => undefined,
    },
  );
  assert.equal(
    await freshness.inspect({
      id: 'source-1',
      projectId: 'project-1',
      canonicalPath: sourcePath,
      sha256: ingested.sha256,
      sizeBytes: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
      gitHead: 'a'.repeat(40),
      gitDirty: false,
    }),
    'STALE',
  );
  assert.ok(stale[0].includes('hash_changed'));

  const dimension = 384;
  const localEmbeddings = new LocalEmbeddingService({
    destination: 'LOCAL_MODEL',
    embed: async ({ model, texts }) => ({
      model,
      vectors: texts.map((text) =>
        Array.from(
          { length: dimension },
          (_, index) => ((text.charCodeAt(index % text.length) || 1) % 31) / 31,
        ),
      ),
    }),
  });
  let vectors = [];
  const semantic = new LocalSemanticSearchService(localEmbeddings, {
    load: async () => vectors.map((item) => ({ chunkId: item.chunkId, vector: item.vector })),
  });
  const hybrid = new HybridKnowledgeSearch(store, semantic);
  const benchmark = await new KnowledgeBenchmark().run({
    corpusFiles: 1,
    corpusBytes: metadata.size,
    embeddingDimension: dimension,
    index: async () => {
      vectors = await localEmbeddings.embed({
        model: 'local-fixture',
        dimension,
        chunks: sources.flatMap(({ id, chunks }) =>
          chunks.map((chunk) => ({
            id: `${id}:${chunk.ordinal}`,
            content: chunk.content,
          })),
        ),
      });
      return {
        chunks: ingested.chunks,
        estimatedDiskBytes: metadata.size + vectors.length * dimension * 8,
      };
    },
    searches: Array.from({ length: 5 }, () => async () => {
      await hybrid.search({
        projectId: 'project-1',
        query: 'setup',
        semanticModel: 'local-fixture',
        semanticDimension: dimension,
      });
    }),
  });
  stdout.write(
    `${JSON.stringify({
      indexedSources: sources.length,
      chunks: ingested.chunks,
      citationResolved: true,
      staleDetected: true,
      lexicalFallback: true,
      semanticIndexed: vectors.length,
      benchmark,
    })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
