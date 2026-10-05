export type KnowledgeSourceType = 'README' | 'MARKDOWN' | 'TEXT' | 'REPORT' | 'DECISION';
export type KnowledgeFreshness = 'FRESH' | 'STALE' | 'EXPIRED' | 'DELETED';

export interface KnowledgeChunk {
  readonly ordinal: number;
  readonly section: string;
  readonly anchor: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly content: string;
  readonly sha256: string;
  readonly classification: 'LOCAL_ONLY';
  readonly trust: 'DATA_ONLY';
}

export interface KnowledgeSourceIdentity {
  readonly projectId: string;
  readonly missionId?: string;
  readonly sourceType: KnowledgeSourceType;
  readonly relativePath: string;
  readonly title: string;
  readonly sha256: string;
  readonly version: number;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
  readonly observedAt: string;
  readonly gitHead?: string;
  readonly gitDirty?: boolean;
  readonly classification: 'LOCAL_ONLY';
  readonly freshness: KnowledgeFreshness;
}

export interface LocalCitation {
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
  readonly uri: string;
}

export interface KnowledgeSearchResult {
  readonly citation: LocalCitation;
  readonly excerpt: string;
  readonly lexicalScore: number;
  readonly semanticScore?: number;
  readonly score: number;
  readonly partial: boolean;
  readonly trust: 'DATA_ONLY';
}
