import { extname } from 'node:path';
import type { ProjectManifest } from './project-manifest.js';
import { ProjectPathGuard, type AuthorizedPath } from './path-guard.js';

const MIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'text/plain': ['.txt', '.md', '.log'],
  'application/json': ['.json'],
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'application/zip': ['.zip'],
};

export interface TransferMetadata {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly firstBytes: Uint8Array;
}

export class TransferDeniedError extends Error {
  constructor(readonly reason: string) {
    super(`Transfer denied: ${reason}`);
    this.name = 'TransferDeniedError';
  }
}

function signatureMatches(mimeType: string, bytes: Uint8Array): boolean {
  const prefix = (...expected: number[]) =>
    expected.every((value, index) => bytes[index] === value);
  if (mimeType === 'image/png') return prefix(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mimeType === 'image/jpeg') return prefix(0xff, 0xd8, 0xff);
  if (mimeType === 'application/pdf') return prefix(0x25, 0x50, 0x44, 0x46, 0x2d);
  if (mimeType === 'application/zip') return prefix(0x50, 0x4b, 0x03, 0x04);
  if (mimeType === 'text/plain' || mimeType === 'application/json') {
    return !bytes.slice(0, 512).some((value) => value === 0);
  }
  return false;
}

export class FileTransferGuard {
  constructor(private readonly paths = new ProjectPathGuard()) {}

  async validate(
    manifest: ProjectManifest,
    metadata: TransferMetadata,
    destination: string,
    maxBytes: number,
  ): Promise<AuthorizedPath> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024) {
      throw new TransferDeniedError('invalid_transfer_limit');
    }
    if (
      !Number.isSafeInteger(metadata.sizeBytes) ||
      metadata.sizeBytes < 0 ||
      metadata.sizeBytes > maxBytes
    ) {
      throw new TransferDeniedError('invalid_or_excessive_size');
    }
    if (
      metadata.fileName.includes('/') ||
      metadata.fileName.includes('\\') ||
      metadata.fileName.includes('\0')
    ) {
      throw new TransferDeniedError('unsafe_file_name');
    }
    const extensions = MIME_EXTENSIONS[metadata.mimeType];
    if (!extensions) throw new TransferDeniedError('mime_not_allowed');
    const extension = extname(metadata.fileName).toLowerCase();
    if (!extensions.includes(extension)) throw new TransferDeniedError('extension_mime_mismatch');
    if (!signatureMatches(metadata.mimeType, metadata.firstBytes))
      throw new TransferDeniedError('signature_mismatch');
    const authorized = await this.paths.authorize(manifest, destination, 'WRITE');
    if (
      authorized.canonicalPath.toLowerCase().endsWith('.exe') ||
      authorized.canonicalPath.toLowerCase().endsWith('.ps1')
    ) {
      throw new TransferDeniedError('executable_destination_forbidden');
    }
    return authorized;
  }
}
