import { describe, expect, it } from 'vitest';
import { FileTransferGuard } from './transfer-guard.js';
import type { ProjectManifest } from './project-manifest.js';

const manifest: ProjectManifest = {
  version: 1,
  projectId: 'p',
  machineId: 'm',
  rootPath: 'C:\\project',
  stack: [],
  environments: ['LOCAL'],
  commands: {},
  allowedPaths: ['incoming'],
  deniedPaths: [],
  protectedFiles: [],
  directoryLimits: {},
};
const canonicalize = async (path: string) => path.replace('C:\\project\\', 'C:\\project\\');

describe('FileTransferGuard', () => {
  it('accepts matching MIME, extension, signature, size and destination', async () => {
    const guard = new FileTransferGuard(
      new (await import('./path-guard.js')).ProjectPathGuard(canonicalize),
    );
    await expect(
      guard.validate(
        manifest,
        {
          fileName: 'image.png',
          mimeType: 'image/png',
          sizeBytes: 8,
          firstBytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        },
        'incoming/image.png',
        100,
      ),
    ).resolves.toMatchObject({ relativePath: 'incoming\\image.png' });
  });

  it.each([
    [
      {
        fileName: 'file.exe',
        mimeType: 'image/png',
        sizeBytes: 8,
        firstBytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      },
      'extension_mime_mismatch',
    ],
    [
      {
        fileName: 'image.png',
        mimeType: 'image/png',
        sizeBytes: 101,
        firstBytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      },
      'invalid_or_excessive_size',
    ],
    [
      {
        fileName: 'image.png',
        mimeType: 'image/png',
        sizeBytes: 8,
        firstBytes: Uint8Array.from([1, 2, 3]),
      },
      'signature_mismatch',
    ],
    [
      {
        fileName: '../image.png',
        mimeType: 'image/png',
        sizeBytes: 8,
        firstBytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      },
      'unsafe_file_name',
    ],
  ])('rejects invalid transfer metadata', async (metadata, reason) => {
    const guard = new FileTransferGuard(
      new (await import('./path-guard.js')).ProjectPathGuard(canonicalize),
    );
    await expect(
      guard.validate(manifest, metadata, 'incoming/image.png', 100),
    ).rejects.toMatchObject({ reason });
  });
});
