export interface KnowledgeAdministrationStore {
  enqueueReindex(projectId: string, sourceId: string, reason: string): Promise<string>;
  enqueueProjectReindex(projectId: string, reason: string): Promise<string>;
  purgeProject(
    projectId: string,
    reason: string,
  ): Promise<Readonly<Record<string, number | string>>>;
  runRetention(): Promise<Readonly<Record<string, number>>>;
}

export interface DerivedKnowledgeArtifactStore {
  purgeProject(projectId: string): Promise<Readonly<{ files: number; bytes: number }>>;
}

export interface StrongPurgeAuthorizationPort {
  consume(input: {
    readonly projectId: string;
    readonly authorizationReference: string;
  }): Promise<boolean>;
}

export interface KnowledgeAdministrationAuditPort {
  record(event: Readonly<Record<string, unknown>>): Promise<void>;
}

export class KnowledgeAdministrationError extends Error {
  constructor(readonly reason: string) {
    super(`Knowledge administration rejected: ${reason}`);
    this.name = 'KnowledgeAdministrationError';
  }
}

export class KnowledgeAdministrationService {
  constructor(
    private readonly store: KnowledgeAdministrationStore,
    private readonly artifacts: DerivedKnowledgeArtifactStore,
    private readonly authorizations: StrongPurgeAuthorizationPort,
    private readonly audit: KnowledgeAdministrationAuditPort,
  ) {}

  async reindex(projectId: string, sourceId?: string): Promise<string> {
    const jobId = sourceId
      ? await this.store.enqueueReindex(projectId, sourceId, 'explicit_reindex')
      : await this.store.enqueueProjectReindex(projectId, 'explicit_project_reindex');
    await this.audit.record({ operation: 'KNOWLEDGE_REINDEX_QUEUED', projectId, sourceId, jobId });
    return jobId;
  }

  async purgeProject(projectId: string, reason: string, authorizationReference: string) {
    if (!reason.trim() || reason.length > 500)
      throw new KnowledgeAdministrationError('invalid_reason');
    if (!(await this.authorizations.consume({ projectId, authorizationReference }))) {
      throw new KnowledgeAdministrationError('strong_confirmation_required');
    }
    const database = await this.store.purgeProject(projectId, reason);
    const artifacts = await this.artifacts.purgeProject(projectId);
    const report = { ...database, derivedFiles: artifacts.files, derivedBytes: artifacts.bytes };
    await this.audit.record({ operation: 'KNOWLEDGE_PROJECT_PURGED', projectId, report });
    return report;
  }

  async runRetention(): Promise<Readonly<Record<string, number>>> {
    const report = await this.store.runRetention();
    await this.audit.record({ operation: 'KNOWLEDGE_RETENTION_COMPLETED', report });
    return report;
  }
}
import { lstat, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

async function measure(directory: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const nested = await measure(path);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += (await lstat(path)).size;
    }
  }
  return { files, bytes };
}

export class LocalDerivedKnowledgeArtifactStore implements DerivedKnowledgeArtifactStore {
  constructor(private readonly root: string) {}

  async purgeProject(projectId: string): Promise<Readonly<{ files: number; bytes: number }>> {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(projectId)) {
      throw new KnowledgeAdministrationError('invalid_project_artifact_key');
    }
    const root = resolve(this.root);
    const target = resolve(root, projectId);
    const inside = relative(root, target);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
      throw new KnowledgeAdministrationError('artifact_path_escape');
    }
    try {
      const metadata = await lstat(target);
      const report =
        metadata.isDirectory() && !metadata.isSymbolicLink()
          ? await measure(target)
          : { files: metadata.isFile() ? 1 : 0, bytes: metadata.isFile() ? metadata.size : 0 };
      await rm(target, { recursive: true, force: true });
      return report;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { files: 0, bytes: 0 };
      throw error;
    }
  }
}
