import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PersistedVault, VaultStore } from './vault.js';

export class FileVaultStore implements VaultStore {
  constructor(private readonly path: string) {}

  async load(): Promise<PersistedVault | null> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as PersistedVault;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('Unable to read local vault', { cause: error });
    }
  }

  async save(vault: PersistedVault): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(vault), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.path);
  }
}
