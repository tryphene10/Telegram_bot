import { lstat, readFile } from 'node:fs/promises';
import { basename, extname, win32 } from 'node:path';
import { SecretRedactor } from '@arcc/security';
import type { ProjectManifest, ProjectPathGuard } from '@arcc/tools';
import { chunkKnowledgeText, normalizeKnowledgeText, sha256 } from './chunking.js';
import type { KnowledgeChunk, KnowledgeSourceIdentity, KnowledgeSourceType } from './types.js';

export interface KnowledgeFileSnapshot {
  readonly bytes: Uint8Array;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
  readonly symbolicLink: boolean;
}

export interface KnowledgeFilePort {
  read(canonicalPath: string): Promise<KnowledgeFileSnapshot>;
}

export class LocalKnowledgeFilePort implements KnowledgeFilePort {
  async read(canonicalPath: string): Promise<KnowledgeFileSnapshot> {
    const metadata = await lstat(canonicalPath);
    return {
      bytes: await readFile(canonicalPath),
      sizeBytes: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
      symbolicLink: metadata.isSymbolicLink(),
    };
  }
}

export interface KnowledgeIngestionStore {
  upsert(input: {
    readonly source: KnowledgeSourceIdentity;
    readonly chunks: readonly KnowledgeChunk[];
    readonly searchConfig: string;
  }): Promise<Readonly<{ sourceId: string; inserted: boolean; chunks: number }>>;
}

export interface GitStatePort {
  inspect(projectRoot: string): Promise<Readonly<{ head?: string; dirty?: boolean }>>;
}

export class KnowledgeIngestionError extends Error {
  constructor(readonly reason: string) {
    super(`Knowledge ingestion rejected: ${reason}`);
    this.name = 'KnowledgeIngestionError';
  }
}

function sourceType(relativePath: string): KnowledgeSourceType | undefined {
  const name = basename(relativePath).toLowerCase();
  const extension = extname(name);
  if (/^readme(?:\..+)?$/u.test(name)) return 'README';
  if (['.md', '.markdown'].includes(extension)) return 'MARKDOWN';
  if (extension === '.txt') {
    if (/(?:^|[\\/])reports?[\\/]/u.test(relativePath.toLowerCase())) return 'REPORT';
    if (/(?:^|[\\/])(?:decisions?|adr)[\\/]/u.test(relativePath.toLowerCase())) return 'DECISION';
    return 'TEXT';
  }
  return undefined;
}

function binaryContent(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true;
  const controls = bytes.filter((value) => value < 9 || (value > 13 && value < 32)).length;
  return bytes.length > 0 && controls / bytes.length > 0.01;
}

export class KnowledgeIngestionService {
  constructor(
    private readonly paths: ProjectPathGuard,
    private readonly files: KnowledgeFilePort,
    private readonly store: KnowledgeIngestionStore,
    private readonly git: GitStatePort,
    private readonly redactor = new SecretRedactor(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ingest(input: {
    readonly manifest: ProjectManifest;
    readonly projectId: string;
    readonly missionId?: string;
    readonly requestedPath: string;
    readonly version: number;
    readonly maximumBytes?: number;
    readonly maximumChunkCharacters?: number;
    readonly searchConfig?: string;
  }): Promise<Readonly<{ sourceId: string; inserted: boolean; chunks: number; sha256: string }>> {
    const maximumBytes = input.maximumBytes ?? 1024 * 1024;
    if (
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > 10 * 1024 * 1024
    ) {
      throw new KnowledgeIngestionError('invalid_size_limit');
    }
    if (!Number.isSafeInteger(input.version) || input.version < 1) {
      throw new KnowledgeIngestionError('invalid_version');
    }
    const authorized = await this.paths.authorize(input.manifest, input.requestedPath, 'READ');
    const protectedPath = win32.normalize(authorized.relativePath).toLowerCase();
    if (
      input.manifest.protectedFiles.some((rule) => {
        const protectedRule = win32.normalize(rule).replace(/^\.\\/u, '').toLowerCase();
        return protectedPath === protectedRule || protectedPath.startsWith(`${protectedRule}\\`);
      })
    ) {
      throw new KnowledgeIngestionError('protected_file_forbidden');
    }
    const type = sourceType(authorized.relativePath);
    if (!type) throw new KnowledgeIngestionError('unsupported_file_type');
    const snapshot = await this.files.read(authorized.canonicalPath);
    if (snapshot.symbolicLink) throw new KnowledgeIngestionError('symbolic_link_forbidden');
    if (snapshot.sizeBytes !== snapshot.bytes.byteLength || snapshot.sizeBytes > maximumBytes) {
      throw new KnowledgeIngestionError('file_too_large_or_changed');
    }
    if (binaryContent(snapshot.bytes)) throw new KnowledgeIngestionError('binary_file_forbidden');
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes);
    } catch {
      throw new KnowledgeIngestionError('invalid_utf8');
    }
    const normalized = normalizeKnowledgeText(decoded);
    if (!normalized) throw new KnowledgeIngestionError('empty_source');
    if (this.redactor.redact(normalized).replacements > 0) {
      throw new KnowledgeIngestionError('secret_content_forbidden');
    }
    const chunks = chunkKnowledgeText(normalized, input.maximumChunkCharacters);
    const digest = sha256(snapshot.bytes);
    const git = await this.git.inspect(authorized.canonicalRoot);
    const source: KnowledgeSourceIdentity = {
      projectId: input.projectId,
      ...(input.missionId ? { missionId: input.missionId } : {}),
      sourceType: type,
      relativePath: authorized.relativePath.replaceAll('\\', '/'),
      title: chunks[0]?.section ?? basename(authorized.relativePath),
      sha256: digest,
      version: input.version,
      sizeBytes: snapshot.sizeBytes,
      modifiedAt: snapshot.modifiedAt,
      observedAt: this.now().toISOString(),
      ...(git.head ? { gitHead: git.head } : {}),
      ...(git.dirty === undefined ? {} : { gitDirty: git.dirty }),
      classification: 'LOCAL_ONLY',
      freshness: 'FRESH',
    };
    const saved = await this.store.upsert({
      source,
      chunks,
      searchConfig: input.searchConfig ?? 'simple',
    });
    return { ...saved, sha256: digest };
  }
}
