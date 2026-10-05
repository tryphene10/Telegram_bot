import { sha256 } from './chunking.js';

export interface ObservedKnowledgeSource {
  readonly id: string;
  readonly projectId: string;
  readonly canonicalPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
  readonly gitHead?: string;
  readonly gitDirty?: boolean;
}

export interface FreshnessObservationPort {
  observe(
    canonicalPath: string,
  ): Promise<
    Readonly<{ exists: boolean; bytes?: Uint8Array; sizeBytes?: number; modifiedAt?: string }>
  >;
  git(projectId: string): Promise<Readonly<{ head?: string; dirty?: boolean }>>;
}

export interface FreshnessMutationPort {
  markStale(sourceId: string, reason: string): Promise<void>;
  markDeleted(sourceId: string, reason: string): Promise<void>;
  enqueueReindex(projectId: string, sourceId: string, reason: string): Promise<void>;
}

export class KnowledgeFreshnessService {
  constructor(
    private readonly observations: FreshnessObservationPort,
    private readonly mutations: FreshnessMutationPort,
  ) {}

  async inspect(source: ObservedKnowledgeSource): Promise<'FRESH' | 'STALE' | 'DELETED'> {
    const file = await this.observations.observe(source.canonicalPath);
    if (!file.exists) {
      await this.mutations.markDeleted(source.id, 'source_missing');
      return 'DELETED';
    }
    const git = await this.observations.git(source.projectId);
    const reasons = [
      file.sizeBytes !== source.sizeBytes && 'size_changed',
      file.modifiedAt !== source.modifiedAt && 'mtime_changed',
      file.bytes && sha256(file.bytes) !== source.sha256 && 'hash_changed',
      source.gitHead !== undefined && git.head !== source.gitHead && 'git_head_changed',
      source.gitDirty !== undefined && git.dirty !== source.gitDirty && 'git_status_changed',
    ].filter((value): value is string => Boolean(value));
    if (reasons.length === 0) return 'FRESH';
    const reason = reasons.join(',');
    await this.mutations.markStale(source.id, reason);
    await this.mutations.enqueueReindex(source.projectId, source.id, reason);
    return 'STALE';
  }
}

export interface KnowledgeIndexJob {
  readonly id: string;
  readonly projectId: string;
  readonly sourceId?: string;
  readonly jobKey: string;
  readonly attempts: number;
}

export interface KnowledgeIndexJobStore {
  recoverExpired(): Promise<number>;
  claim(worker: string, leaseSeconds: number): Promise<KnowledgeIndexJob | undefined>;
  complete(jobId: string, worker: string, metrics: Readonly<Record<string, number>>): Promise<void>;
  fail(jobId: string, worker: string, errorCode: string, retryable: boolean): Promise<void>;
}

export interface KnowledgeIndexJobHandler {
  run(job: KnowledgeIndexJob): Promise<Readonly<Record<string, number>>>;
}

export class KnowledgeIndexWorker {
  constructor(
    private readonly store: KnowledgeIndexJobStore,
    private readonly handler: KnowledgeIndexJobHandler,
    private readonly leaseSeconds = 60,
  ) {}

  async tick(worker: string): Promise<'IDLE' | 'COMPLETED' | 'RETRYING' | 'FAILED'> {
    await this.store.recoverExpired();
    const job = await this.store.claim(worker, this.leaseSeconds);
    if (!job) return 'IDLE';
    try {
      const metrics = await this.handler.run(job);
      await this.store.complete(job.id, worker, metrics);
      return 'COMPLETED';
    } catch (error) {
      const retryable = job.attempts < 5;
      await this.store.fail(
        job.id,
        worker,
        error instanceof Error ? error.name : 'unknown_index_error',
        retryable,
      );
      return retryable ? 'RETRYING' : 'FAILED';
    }
  }
}
