import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface MaskRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AnnotationRectangle extends MaskRectangle {
  readonly marker: string;
}

export type ScreenshotTarget =
  | Readonly<{ kind: 'VIRTUAL_SCREEN' }>
  | Readonly<{ kind: 'MONITOR'; monitorIndex: number; expectedBounds: MaskRectangle }>
  | Readonly<{ kind: 'WINDOW'; windowHandle: string; expectedBounds: MaskRectangle }>
  | Readonly<{ kind: 'REGION'; bounds: MaskRectangle }>;

export interface ScreenshotCaptureProvider {
  capture(input: {
    readonly imagePath: string;
    readonly previewPath: string;
    readonly target: ScreenshotTarget;
    readonly masks: readonly MaskRectangle[];
    readonly annotations: readonly AnnotationRectangle[];
    readonly previewMaxWidth: number;
    readonly previewMaxHeight: number;
    readonly jpegQuality: number;
  }): Promise<void>;
}

export interface ScreenshotAuditSink {
  record(event: {
    readonly operation: 'SCREENSHOT_CAPTURED' | 'SCREENSHOT_EXPIRED';
    readonly artifactId: string;
    readonly sizeBytes?: number;
    readonly expiresAt?: number;
  }): Promise<void>;
}

export interface ScreenshotArtifact {
  readonly id: string;
  readonly imagePath: string;
  readonly previewPath: string;
  readonly sizeBytes: number;
  readonly previewSizeBytes: number;
  readonly classification: 'LOCAL_ONLY';
  readonly trust: 'DATA_ONLY';
  readonly target: ScreenshotTarget;
  readonly expiresAt: number;
}

export class ScreenshotError extends Error {
  constructor(readonly reason: string) {
    super(`Screenshot failed: ${reason}`);
    this.name = 'ScreenshotError';
  }
}

export class ScreenshotService {
  private readonly artifacts = new Map<string, ScreenshotArtifact>();

  constructor(
    private readonly directory: string,
    private readonly provider: ScreenshotCaptureProvider,
    private readonly audit: ScreenshotAuditSink,
    private readonly now: () => number = Date.now,
  ) {}

  async capture(options: {
    readonly target?: ScreenshotTarget;
    readonly masks?: readonly MaskRectangle[];
    readonly annotations?: readonly AnnotationRectangle[];
    readonly retentionMs: number;
    readonly maxImageBytes: number;
    readonly maxPreviewBytes: number;
    readonly previewMaxWidth?: number;
    readonly previewMaxHeight?: number;
    readonly jpegQuality?: number;
  }): Promise<ScreenshotArtifact> {
    if (
      !Number.isSafeInteger(options.retentionMs) ||
      options.retentionMs < 1 ||
      options.retentionMs > 86_400_000
    )
      throw new ScreenshotError('invalid_retention');
    const masks = options.masks ?? [];
    if (masks.length > 100 || masks.some((mask) => !this.validMask(mask)))
      throw new ScreenshotError('invalid_mask');
    const annotations = options.annotations ?? [];
    if (
      annotations.length > 100 ||
      annotations.some(
        (annotation) =>
          !this.validMask(annotation) || !/^[A-Z0-9_-]{1,16}$/u.test(annotation.marker),
      )
    )
      throw new ScreenshotError('invalid_annotation');
    const target = options.target ?? { kind: 'VIRTUAL_SCREEN' };
    if (!this.validTarget(target)) throw new ScreenshotError('invalid_target');
    const dimensions =
      target.kind === 'MONITOR' || target.kind === 'WINDOW'
        ? target.expectedBounds
        : target.kind === 'REGION'
          ? target.bounds
          : undefined;
    if (
      dimensions &&
      masks.some(
        (mask) =>
          mask.x + mask.width > dimensions.width || mask.y + mask.height > dimensions.height,
      )
    ) {
      throw new ScreenshotError('mask_outside_target');
    }
    if (
      dimensions &&
      annotations.some(
        (annotation) =>
          annotation.x + annotation.width > dimensions.width ||
          annotation.y + annotation.height > dimensions.height,
      )
    )
      throw new ScreenshotError('annotation_outside_target');
    const previewMaxWidth = options.previewMaxWidth ?? 1_280;
    const previewMaxHeight = options.previewMaxHeight ?? 720;
    const jpegQuality = options.jpegQuality ?? 70;
    if (
      ![
        previewMaxWidth,
        previewMaxHeight,
        jpegQuality,
        options.maxImageBytes,
        options.maxPreviewBytes,
      ].every((value) => Number.isSafeInteger(value) && value > 0) ||
      jpegQuality > 100
    ) {
      throw new ScreenshotError('invalid_limits');
    }
    await mkdir(this.directory, { recursive: true });
    const id = randomUUID();
    const imagePath = join(this.directory, `arcc-screenshot-${id}.png`);
    const previewPath = join(this.directory, `arcc-screenshot-${id}.preview.jpg`);
    const metadataPath = join(this.directory, `arcc-screenshot-${id}.json`);
    try {
      await this.provider.capture({
        imagePath,
        previewPath,
        target,
        masks,
        annotations,
        previewMaxWidth,
        previewMaxHeight,
        jpegQuality,
      });
      const [image, preview] = await Promise.all([stat(imagePath), stat(previewPath)]);
      if (!image.isFile() || !preview.isFile())
        throw new ScreenshotError('provider_output_missing');
      if (image.size > options.maxImageBytes || preview.size > options.maxPreviewBytes)
        throw new ScreenshotError('capture_too_large');
      const artifact: ScreenshotArtifact = {
        id,
        imagePath,
        previewPath,
        sizeBytes: image.size,
        previewSizeBytes: preview.size,
        classification: 'LOCAL_ONLY',
        trust: 'DATA_ONLY',
        target,
        expiresAt: this.now() + options.retentionMs,
      };
      await writeFile(metadataPath, JSON.stringify({ id, expiresAt: artifact.expiresAt }), {
        encoding: 'utf8',
        flag: 'wx',
      });
      this.artifacts.set(id, artifact);
      await this.audit.record({
        operation: 'SCREENSHOT_CAPTURED',
        artifactId: id,
        sizeBytes: image.size,
        expiresAt: artifact.expiresAt,
      });
      return artifact;
    } catch (error) {
      await Promise.all([
        rm(imagePath, { force: true }),
        rm(previewPath, { force: true }),
        rm(metadataPath, { force: true }),
      ]);
      throw error;
    }
  }

  async cleanupExpired(): Promise<number> {
    await mkdir(this.directory, { recursive: true });
    let removed = 0;
    for (const artifact of [...this.artifacts.values()]) {
      if (artifact.expiresAt > this.now()) continue;
      await Promise.all([
        rm(artifact.imagePath, { force: true }),
        rm(artifact.previewPath, { force: true }),
        rm(join(this.directory, `arcc-screenshot-${artifact.id}.json`), { force: true }),
      ]);
      this.artifacts.delete(artifact.id);
      removed += 1;
      await this.audit.record({ operation: 'SCREENSHOT_EXPIRED', artifactId: artifact.id });
    }
    const files = await readdir(this.directory);
    for (const file of files) {
      const match = /^arcc-screenshot-([a-f0-9-]+)\.json$/u.exec(file);
      if (!match) continue;
      const artifactId = match[1];
      if (!artifactId) continue;
      try {
        const metadata = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as {
          id?: unknown;
          expiresAt?: unknown;
        };
        if (metadata.id !== artifactId || typeof metadata.expiresAt !== 'number') continue;
        if (metadata.expiresAt > this.now()) continue;
        await Promise.all([
          rm(join(this.directory, `arcc-screenshot-${artifactId}.png`), { force: true }),
          rm(join(this.directory, `arcc-screenshot-${artifactId}.preview.jpg`), { force: true }),
          rm(join(this.directory, file), { force: true }),
        ]);
        if (!this.artifacts.has(artifactId)) {
          removed += 1;
          await this.audit.record({ operation: 'SCREENSHOT_EXPIRED', artifactId });
        }
      } catch {
        continue;
      }
    }
    const orphanCutoff = this.now() - 86_400_000;
    for (const file of await readdir(this.directory)) {
      if (!/^arcc-screenshot-[a-f0-9-]+(?:\.preview)?\.(?:png|jpg)$/u.test(file)) continue;
      const path = join(this.directory, file);
      if ((await stat(path)).mtimeMs < orphanCutoff) await rm(path, { force: true });
    }
    return removed;
  }

  private validMask(mask: MaskRectangle): boolean {
    return (
      [mask.x, mask.y, mask.width, mask.height].every(Number.isSafeInteger) &&
      mask.x >= 0 &&
      mask.y >= 0 &&
      mask.width > 0 &&
      mask.height > 0
    );
  }

  private validTarget(target: ScreenshotTarget): boolean {
    if (target.kind === 'VIRTUAL_SCREEN') return true;
    const bounds = target.kind === 'REGION' ? target.bounds : target.expectedBounds;
    const validBounds =
      [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) &&
      bounds.width > 0 &&
      bounds.height > 0;
    if (!validBounds) return false;
    if (target.kind === 'MONITOR') {
      return Number.isSafeInteger(target.monitorIndex) && target.monitorIndex >= 0;
    }
    if (target.kind === 'WINDOW') return /^\d+$/u.test(target.windowHandle);
    return true;
  }
}
