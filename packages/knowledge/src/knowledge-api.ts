import type { KnowledgeIngestionService } from './ingestion.js';
import type { HybridKnowledgeSearch } from './search.js';
import type { KnowledgeFreshnessService, ObservedKnowledgeSource } from './freshness.js';

export interface KnowledgeAdministrationPort {
  reindex(projectId: string, sourceId?: string): Promise<string>;
  purgeProject(
    projectId: string,
    reason: string,
    authorizationReference: string,
  ): Promise<Readonly<Record<string, number | string>>>;
  runRetention(): Promise<Readonly<Record<string, number>>>;
}

export class LocalKnowledgeApi {
  constructor(
    private readonly ingestion: KnowledgeIngestionService,
    private readonly searcher: HybridKnowledgeSearch,
    private readonly freshness: KnowledgeFreshnessService,
    private readonly administration: KnowledgeAdministrationPort,
  ) {}

  ingest(input: Parameters<KnowledgeIngestionService['ingest']>[0]) {
    return this.ingestion.ingest(input);
  }

  search(input: Parameters<HybridKnowledgeSearch['search']>[0]) {
    return this.searcher.search(input);
  }

  getCitation(uri: string) {
    return this.searcher.getCitation(uri);
  }

  markStale(source: ObservedKnowledgeSource) {
    return this.freshness.inspect(source);
  }

  reindex(projectId: string, sourceId?: string) {
    return this.administration.reindex(projectId, sourceId);
  }

  purgeProject(projectId: string, reason: string, authorizationReference: string) {
    return this.administration.purgeProject(projectId, reason, authorizationReference);
  }

  runRetention() {
    return this.administration.runRetention();
  }
}
