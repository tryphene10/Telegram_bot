import { sha256 } from './chunking.js';

export interface LocalEmbeddingAdapter {
  readonly destination: 'LOCAL_MODEL';
  embed(input: {
    readonly model: string;
    readonly texts: readonly string[];
    readonly classification: 'LOCAL_ONLY';
    readonly signal?: AbortSignal;
  }): Promise<Readonly<{ model: string; vectors: readonly (readonly number[])[] }>>;
}

export interface EmbeddedChunk {
  readonly chunkId: string;
  readonly model: string;
  readonly dimension: number;
  readonly namespace: string;
  readonly vector: readonly number[];
  readonly sha256: string;
}

export class LocalEmbeddingError extends Error {
  constructor(readonly reason: string) {
    super(`Local embedding failed: ${reason}`);
    this.name = 'LocalEmbeddingError';
  }
}

function validVector(vector: readonly number[], dimension: number): boolean {
  return vector.length === dimension && vector.every(Number.isFinite);
}

export class LocalEmbeddingService {
  constructor(private readonly adapter: LocalEmbeddingAdapter) {
    if (adapter.destination !== 'LOCAL_MODEL') throw new LocalEmbeddingError('cloud_forbidden');
  }

  async embed(input: {
    readonly model: string;
    readonly dimension: number;
    readonly chunks: readonly Readonly<{ id: string; content: string }>[];
    readonly signal?: AbortSignal;
  }): Promise<readonly EmbeddedChunk[]> {
    if (
      !input.model.trim() ||
      !Number.isSafeInteger(input.dimension) ||
      input.dimension < 1 ||
      input.dimension > 8_192 ||
      input.chunks.length === 0 ||
      input.chunks.length > 256
    ) {
      throw new LocalEmbeddingError('invalid_request');
    }
    const response = await this.adapter.embed({
      model: input.model,
      texts: input.chunks.map(({ content }) => content),
      classification: 'LOCAL_ONLY',
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (response.model !== input.model) throw new LocalEmbeddingError('model_substitution');
    if (
      response.vectors.length !== input.chunks.length ||
      response.vectors.some((vector) => !validVector(vector, input.dimension))
    ) {
      throw new LocalEmbeddingError('invalid_vector_shape');
    }
    const namespace = `${input.model}:${input.dimension}`;
    return input.chunks.map((chunk, index) => {
      const vector = response.vectors[index]!;
      return {
        chunkId: chunk.id,
        model: input.model,
        dimension: input.dimension,
        namespace,
        vector,
        sha256: sha256(JSON.stringify(vector)),
      };
    });
  }
}

export interface LocalEmbeddingVectorStore {
  load(input: {
    readonly projectId: string;
    readonly model: string;
    readonly dimension: number;
    readonly limit: number;
  }): Promise<readonly Readonly<{ chunkId: string; vector: readonly number[] }>[]>;
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))));
}

export class LocalSemanticSearchService {
  readonly destination = 'LOCAL_MODEL' as const;
  constructor(
    private readonly embeddings: LocalEmbeddingService,
    private readonly store: LocalEmbeddingVectorStore,
  ) {}

  async search(input: {
    readonly projectId: string;
    readonly query: string;
    readonly classification: 'LOCAL_ONLY';
    readonly model: string;
    readonly dimension: number;
    readonly limit: number;
  }) {
    if (input.classification !== 'LOCAL_ONLY')
      throw new LocalEmbeddingError('classification_required');
    const [query] = await this.embeddings.embed({
      model: input.model,
      dimension: input.dimension,
      chunks: [{ id: 'query', content: input.query }],
    });
    if (!query) throw new LocalEmbeddingError('query_embedding_missing');
    const candidates = await this.store.load({
      projectId: input.projectId,
      model: input.model,
      dimension: input.dimension,
      limit: Math.min(500, Math.max(input.limit * 10, input.limit)),
    });
    return candidates
      .map(({ chunkId, vector }) => ({ chunkId, score: cosine(query.vector, vector) }))
      .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
      .slice(0, input.limit);
  }
}
