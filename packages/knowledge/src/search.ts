import type { KnowledgeFreshness, KnowledgeSearchResult, LocalCitation } from './types.js';

export interface LexicalCandidate {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly projectId: string;
  readonly relativePath: string;
  readonly section: string;
  readonly anchor: string;
  readonly sourceHash: string;
  readonly chunkHash: string;
  readonly version: number;
  readonly observedAt: string;
  readonly freshness: KnowledgeFreshness;
  readonly excerpt: string;
  readonly lexicalScore: number;
}

export interface KnowledgeSearchStore {
  lexical(input: {
    readonly projectId: string;
    readonly missionId?: string;
    readonly query: string;
    readonly sourceTypes?: readonly string[];
    readonly freshness?: readonly KnowledgeFreshness[];
    readonly observedAfter?: string;
    readonly searchConfig: string;
    readonly limit: number;
    readonly excerptCharacters: number;
    readonly timeoutMs: number;
  }): Promise<readonly LexicalCandidate[]>;
  citation(sourceId: string, chunkHash: string): Promise<LexicalCandidate | undefined>;
}

export interface SemanticSearchPort {
  readonly destination: 'LOCAL_MODEL';
  search(input: {
    readonly projectId: string;
    readonly query: string;
    readonly classification: 'LOCAL_ONLY';
    readonly model: string;
    readonly dimension: number;
    readonly limit: number;
  }): Promise<readonly Readonly<{ chunkId: string; score: number }>[]>;
}

export interface CriticalSourceRevalidator {
  revalidate(candidate: LexicalCandidate): Promise<boolean>;
}

export class KnowledgeSearchError extends Error {
  constructor(readonly reason: string) {
    super(`Knowledge search rejected: ${reason}`);
    this.name = 'KnowledgeSearchError';
  }
}

function citation(candidate: LexicalCandidate): LocalCitation {
  return {
    sourceId: candidate.sourceId,
    projectId: candidate.projectId,
    relativePath: candidate.relativePath,
    section: candidate.section,
    anchor: candidate.anchor,
    sourceHash: candidate.sourceHash,
    chunkHash: candidate.chunkHash,
    version: candidate.version,
    observedAt: candidate.observedAt,
    freshness: candidate.freshness,
    uri: `arcc://knowledge/${candidate.sourceId}/${candidate.anchor}?source=${candidate.sourceHash}&chunk=${candidate.chunkHash}&v=${candidate.version}`,
  };
}

function boundedScore(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export class HybridKnowledgeSearch {
  constructor(
    private readonly store: KnowledgeSearchStore,
    private readonly semantic?: SemanticSearchPort,
    private readonly revalidator?: CriticalSourceRevalidator,
  ) {
    if (semantic && semantic.destination !== 'LOCAL_MODEL') {
      throw new KnowledgeSearchError('cloud_semantic_forbidden');
    }
  }

  async search(input: {
    readonly projectId: string;
    readonly missionId?: string;
    readonly query: string;
    readonly sourceTypes?: readonly string[];
    readonly freshness?: readonly KnowledgeFreshness[];
    readonly observedAfter?: string;
    readonly searchConfig?: string;
    readonly limit?: number;
    readonly excerptCharacters?: number;
    readonly timeoutMs?: number;
    readonly semanticModel?: string;
    readonly semanticDimension?: number;
    readonly critical?: boolean;
  }): Promise<
    Readonly<{ results: readonly KnowledgeSearchResult[]; mode: 'HYBRID' | 'LEXICAL_ONLY' }>
  > {
    const query = input.query.trim();
    const limit = input.limit ?? 10;
    const excerptCharacters = input.excerptCharacters ?? 800;
    const timeoutMs = input.timeoutMs ?? 2_000;
    if (
      !input.projectId.trim() ||
      !query ||
      query.length > 2_000 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      !Number.isSafeInteger(excerptCharacters) ||
      excerptCharacters < 32 ||
      excerptCharacters > 4_000 ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 10 ||
      timeoutMs > 10_000
    ) {
      throw new KnowledgeSearchError('invalid_query_bounds');
    }
    let lexical = await this.store.lexical({
      projectId: input.projectId,
      ...(input.missionId ? { missionId: input.missionId } : {}),
      query,
      ...(input.sourceTypes ? { sourceTypes: input.sourceTypes } : {}),
      freshness: input.freshness ?? ['FRESH'],
      ...(input.observedAfter ? { observedAfter: input.observedAfter } : {}),
      searchConfig: input.searchConfig ?? 'simple',
      limit: Math.min(50, limit * 3),
      excerptCharacters,
      timeoutMs,
    });
    if (input.critical) {
      if (!this.revalidator) throw new KnowledgeSearchError('critical_revalidator_required');
      const checks = await Promise.all(
        lexical.map(async (item) => [item, await this.revalidator!.revalidate(item)] as const),
      );
      lexical = checks.filter(([, valid]) => valid).map(([item]) => item);
    }
    let semanticScores = new Map<string, number>();
    let mode: 'HYBRID' | 'LEXICAL_ONLY' = 'LEXICAL_ONLY';
    if (this.semantic && input.semanticModel && input.semanticDimension) {
      try {
        const semantic = await this.semantic.search({
          projectId: input.projectId,
          query,
          classification: 'LOCAL_ONLY',
          model: input.semanticModel,
          dimension: input.semanticDimension,
          limit: Math.min(50, limit * 3),
        });
        semanticScores = new Map(
          semantic.map(({ chunkId, score }) => [chunkId, boundedScore(score)]),
        );
        mode = 'HYBRID';
      } catch {
        mode = 'LEXICAL_ONLY';
      }
    }
    const results = lexical
      .map((item): KnowledgeSearchResult => {
        const semanticScore = semanticScores.get(item.chunkId);
        const lexicalScore = boundedScore(item.lexicalScore);
        return {
          citation: citation(item),
          excerpt: item.excerpt.slice(0, excerptCharacters),
          lexicalScore,
          ...(semanticScore === undefined ? {} : { semanticScore }),
          score:
            semanticScore === undefined ? lexicalScore : 0.6 * lexicalScore + 0.4 * semanticScore,
          partial: item.freshness !== 'FRESH' || semanticScore === undefined,
          trust: 'DATA_ONLY',
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score || left.citation.uri.localeCompare(right.citation.uri),
      )
      .slice(0, limit);
    return { results, mode };
  }

  async getCitation(uri: string): Promise<LocalCitation | undefined> {
    const match =
      /^arcc:\/\/knowledge\/([^/]+)\/[^?]+\?source=([a-f0-9]{64})&chunk=([a-f0-9]{64})&v=\d+$/u.exec(
        uri,
      );
    if (!match) throw new KnowledgeSearchError('invalid_citation');
    const candidate = await this.store.citation(match[1]!, match[3]!);
    if (!candidate || candidate.sourceHash !== match[2] || candidate.freshness === 'DELETED')
      return undefined;
    return citation(candidate);
  }
}
