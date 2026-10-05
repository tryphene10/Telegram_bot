import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { win32 } from 'node:path';
import type { ProjectManifest } from './project-manifest.js';
import { ProjectPathGuard } from './path-guard.js';

export interface FileToolAuditSink {
  record(event: {
    readonly operation: string;
    readonly relativePath: string;
    readonly bytes?: number;
    readonly rollbackToken?: string;
  }): Promise<void>;
}

export interface FileEntry {
  readonly path: string;
  readonly type: 'FILE' | 'DIRECTORY';
  readonly sizeBytes: number;
}

export interface FileMutationResult {
  readonly path: string;
  readonly bytes: number;
  readonly rollbackToken?: string;
}

interface RollbackEntry {
  readonly originalPath: string;
  readonly backupPath: string;
  readonly kind: 'RESTORE_BACKUP' | 'REMOVE_CREATED' | 'RESTORE_TRASH';
}

export class FileToolError extends Error {
  constructor(readonly reason: string) {
    super(`File tool failed: ${reason}`);
    this.name = 'FileToolError';
  }
}

export class LocalFileTools {
  private readonly rollbacks = new Map<string, RollbackEntry>();

  constructor(
    private readonly manifest: ProjectManifest,
    private readonly audit: FileToolAuditSink,
    private readonly guard = new ProjectPathGuard(),
  ) {}

  async read(
    path: string,
    maxBytes: number,
  ): Promise<Readonly<{ content: string; bytes: number }>> {
    const authorized = await this.guard.authorize(this.manifest, path, 'READ');
    const metadata = await stat(authorized.canonicalPath);
    if (!metadata.isFile()) throw new FileToolError('not_a_file');
    if (metadata.size > maxBytes) throw new FileToolError('file_too_large');
    const content = await readFile(authorized.canonicalPath, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    await this.audit.record({ operation: 'READ', relativePath: authorized.relativePath, bytes });
    return { content, bytes };
  }

  async search(
    startPath: string,
    query: string,
    limits: {
      readonly maxFiles: number;
      readonly maxResults: number;
      readonly maxFileBytes: number;
    },
    signal?: AbortSignal,
  ): Promise<readonly Readonly<{ path: string; line: number; preview: string }>[]> {
    if (!query || query.length > 500) throw new FileToolError('invalid_query');
    const start = await this.guard.authorize(this.manifest, startPath, 'READ');
    const results: Array<{ path: string; line: number; preview: string }> = [];
    const pending = [start.canonicalPath];
    let inspected = 0;
    while (pending.length > 0 && results.length < limits.maxResults) {
      if (signal?.aborted) throw new FileToolError('cancelled');
      const current = pending.shift()!;
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (signal?.aborted) throw new FileToolError('cancelled');
        const fullPath = win32.join(current, entry.name);
        let authorized;
        try {
          authorized = await this.guard.authorize(this.manifest, fullPath, 'READ');
        } catch {
          continue;
        }
        if (entry.isDirectory()) {
          pending.push(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        inspected += 1;
        if (inspected > limits.maxFiles) throw new FileToolError('file_scan_limit');
        const metadata = await stat(fullPath);
        if (metadata.size > limits.maxFileBytes) continue;
        const lines = (await readFile(fullPath, 'utf8')).split(/\r?\n/u);
        for (
          let index = 0;
          index < lines.length && results.length < limits.maxResults;
          index += 1
        ) {
          if (lines[index]!.includes(query)) {
            results.push({
              path: authorized.relativePath,
              line: index + 1,
              preview: lines[index]!.slice(0, 300),
            });
          }
        }
      }
    }
    await this.audit.record({ operation: 'SEARCH', relativePath: start.relativePath });
    return results;
  }

  async list(path: string, maxEntries: number): Promise<readonly FileEntry[]> {
    const authorized = await this.guard.authorize(this.manifest, path, 'READ');
    const entries = await readdir(authorized.canonicalPath, { withFileTypes: true });
    if (entries.length > maxEntries) throw new FileToolError('entry_limit');
    const result: FileEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile() && !entry.isDirectory()) continue;
      const fullPath = win32.join(authorized.canonicalPath, entry.name);
      let child;
      try {
        child = await this.guard.authorize(this.manifest, fullPath, 'READ');
      } catch {
        continue;
      }
      const metadata = await stat(fullPath);
      result.push({
        path: child.relativePath,
        type: entry.isDirectory() ? 'DIRECTORY' : 'FILE',
        sizeBytes: entry.isFile() ? metadata.size : 0,
      });
    }
    await this.audit.record({ operation: 'LIST', relativePath: authorized.relativePath });
    return result;
  }

  async write(path: string, content: string, maxBytes: number): Promise<FileMutationResult> {
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > maxBytes) throw new FileToolError('content_too_large');
    const authorized = await this.guard.authorize(this.manifest, path, 'WRITE');
    await mkdir(win32.dirname(authorized.canonicalPath), { recursive: true });
    const result = await this.atomicReplace(authorized.canonicalPath, Buffer.from(content));
    await this.audit.record({
      operation: 'WRITE',
      relativePath: authorized.relativePath,
      bytes,
      rollbackToken: result.rollbackToken,
    });
    return { path: authorized.relativePath, bytes, rollbackToken: result.rollbackToken };
  }

  async copy(source: string, destination: string, maxBytes: number): Promise<FileMutationResult> {
    const from = await this.guard.authorize(this.manifest, source, 'READ');
    const to = await this.guard.authorize(this.manifest, destination, 'WRITE');
    const metadata = await stat(from.canonicalPath);
    if (!metadata.isFile()) throw new FileToolError('not_a_file');
    if (metadata.size > maxBytes) throw new FileToolError('file_too_large');
    await mkdir(win32.dirname(to.canonicalPath), { recursive: true });
    const temporary = `${to.canonicalPath}.arcc-temp-${randomUUID()}`;
    await copyFile(from.canonicalPath, temporary);
    const result = await this.commitTemporary(to.canonicalPath, temporary);
    await this.audit.record({
      operation: 'COPY',
      relativePath: to.relativePath,
      bytes: metadata.size,
      rollbackToken: result.rollbackToken,
    });
    return { path: to.relativePath, bytes: metadata.size, rollbackToken: result.rollbackToken };
  }

  async move(source: string, destination: string): Promise<FileMutationResult> {
    const from = await this.guard.authorize(this.manifest, source, 'WRITE');
    const to = await this.guard.authorize(this.manifest, destination, 'WRITE');
    const metadata = await stat(from.canonicalPath);
    if (!metadata.isFile()) throw new FileToolError('not_a_file');
    await mkdir(win32.dirname(to.canonicalPath), { recursive: true });
    if (await this.exists(to.canonicalPath)) throw new FileToolError('destination_exists');
    await rename(from.canonicalPath, to.canonicalPath);
    const token = randomUUID();
    this.rollbacks.set(token, {
      originalPath: from.canonicalPath,
      backupPath: to.canonicalPath,
      kind: 'RESTORE_TRASH',
    });
    await this.audit.record({
      operation: 'MOVE',
      relativePath: from.relativePath,
      bytes: metadata.size,
      rollbackToken: token,
    });
    return { path: to.relativePath, bytes: metadata.size, rollbackToken: token };
  }

  async removeRecoverably(
    path: string,
  ): Promise<Readonly<{ path: string; rollbackToken: string }>> {
    const target = await this.guard.authorize(this.manifest, path, 'WRITE');
    const root = target.canonicalRoot;
    const trashDirectory = win32.join(root, '.arcc-trash');
    await mkdir(trashDirectory, { recursive: true });
    const trashPath = win32.join(
      trashDirectory,
      `${randomUUID()}-${win32.basename(target.canonicalPath)}`,
    );
    await rename(target.canonicalPath, trashPath);
    const token = randomUUID();
    this.rollbacks.set(token, {
      originalPath: target.canonicalPath,
      backupPath: trashPath,
      kind: 'RESTORE_TRASH',
    });
    await this.audit.record({
      operation: 'REMOVE_RECOVERABLE',
      relativePath: target.relativePath,
      rollbackToken: token,
    });
    return { path: target.relativePath, rollbackToken: token };
  }

  async rollback(token: string): Promise<void> {
    const entry = this.rollbacks.get(token);
    if (!entry) throw new FileToolError('unknown_rollback_token');
    if (entry.kind === 'REMOVE_CREATED') {
      await rm(entry.originalPath, { force: true });
    } else if (entry.kind === 'RESTORE_BACKUP') {
      await rm(entry.originalPath, { force: true });
      await rename(entry.backupPath, entry.originalPath);
    } else {
      await mkdir(win32.dirname(entry.originalPath), { recursive: true });
      await rename(entry.backupPath, entry.originalPath);
    }
    this.rollbacks.delete(token);
  }

  private async atomicReplace(path: string, content: Buffer): Promise<{ rollbackToken: string }> {
    const temporary = `${path}.arcc-temp-${randomUUID()}`;
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return this.commitTemporary(path, temporary);
  }

  private async commitTemporary(
    path: string,
    temporary: string,
  ): Promise<{ rollbackToken: string }> {
    const token = randomUUID();
    if (await this.exists(path)) {
      const backup = `${path}.arcc-backup-${randomUUID()}`;
      await rename(path, backup);
      try {
        await rename(temporary, path);
      } catch (error) {
        await rename(backup, path);
        await rm(temporary, { force: true });
        throw error;
      }
      this.rollbacks.set(token, { originalPath: path, backupPath: backup, kind: 'RESTORE_BACKUP' });
    } else {
      await rename(temporary, path);
      this.rollbacks.set(token, { originalPath: path, backupPath: '', kind: 'REMOVE_CREATED' });
    }
    return { rollbackToken: token };
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}
