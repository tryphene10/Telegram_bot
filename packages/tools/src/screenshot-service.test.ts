import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenshotService } from './screenshot-service.js';

describe('ScreenshotService', () => {
  let directory = '';
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('creates a compressed preview, masks through the provider and expires both artifacts', async () => {
    directory = await mkdtemp(join(tmpdir(), 'arcc-capture-'));
    const provider = {
      capture: vi.fn(async ({ imagePath, previewPath }) => {
        await writeFile(imagePath, 'full');
        await writeFile(previewPath, 'preview');
      }),
    };
    const audit = { record: vi.fn(async () => undefined) };
    let now = 1_000;
    const service = new ScreenshotService(directory, provider, audit, () => now);
    const artifact = await service.capture({
      target: { kind: 'REGION', bounds: { x: 10, y: 20, width: 100, height: 80 } },
      masks: [{ x: 1, y: 2, width: 3, height: 4 }],
      annotations: [{ x: 5, y: 6, width: 20, height: 10, marker: 'TARGET_1' }],
      retentionMs: 10,
      maxImageBytes: 100,
      maxPreviewBytes: 100,
      jpegQuality: 60,
    });
    expect(artifact.classification).toBe('LOCAL_ONLY');
    expect(artifact.trust).toBe('DATA_ONLY');
    expect(artifact.target.kind).toBe('REGION');
    expect(provider.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        masks: [{ x: 1, y: 2, width: 3, height: 4 }],
        annotations: [{ x: 5, y: 6, width: 20, height: 10, marker: 'TARGET_1' }],
        jpegQuality: 60,
      }),
    );
    now = 1_011;
    const restarted = new ScreenshotService(directory, provider, audit, () => now);
    await expect(restarted.cleanupExpired()).resolves.toBe(1);
    await expect(stat(artifact.imagePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(artifact.previewPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects invalid masks and deletes excessive provider output', async () => {
    directory = await mkdtemp(join(tmpdir(), 'arcc-capture-'));
    const provider = {
      capture: vi.fn(async ({ imagePath, previewPath }) => {
        await writeFile(imagePath, 'too-large');
        await writeFile(previewPath, 'ok');
      }),
    };
    const service = new ScreenshotService(directory, provider, { record: vi.fn() });
    const options = { retentionMs: 10, maxImageBytes: 2, maxPreviewBytes: 10 };
    await expect(
      service.capture({ ...options, masks: [{ x: -1, y: 0, width: 1, height: 1 }] }),
    ).rejects.toMatchObject({ reason: 'invalid_mask' });
    await expect(
      service.capture({
        ...options,
        target: {
          kind: 'WINDOW',
          windowHandle: 'not-a-handle',
          expectedBounds: { x: 0, y: 0, width: 10, height: 10 },
        },
      }),
    ).rejects.toMatchObject({ reason: 'invalid_target' });
    await expect(
      service.capture({
        ...options,
        target: { kind: 'REGION', bounds: { x: 0, y: 0, width: 10, height: 10 } },
        masks: [{ x: 9, y: 9, width: 2, height: 2 }],
      }),
    ).rejects.toMatchObject({ reason: 'mask_outside_target' });
    await expect(
      service.capture({
        ...options,
        annotations: [{ x: 0, y: 0, width: 1, height: 1, marker: 'secret text' }],
      }),
    ).rejects.toMatchObject({ reason: 'invalid_annotation' });
    await expect(
      service.capture({
        ...options,
        target: { kind: 'REGION', bounds: { x: 0, y: 0, width: 10, height: 10 } },
        annotations: [{ x: 9, y: 9, width: 2, height: 2, marker: 'TARGET_2' }],
      }),
    ).rejects.toMatchObject({ reason: 'annotation_outside_target' });
    await expect(service.capture(options)).rejects.toMatchObject({ reason: 'capture_too_large' });
  });
});
