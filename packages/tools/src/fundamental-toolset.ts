import type { LocalFileTools } from './filesystem-tools.js';
import type {
  AnnotationRectangle,
  ScreenshotService,
  ScreenshotTarget,
  MaskRectangle,
} from './screenshot-service.js';
import { collectSafeSystemInfo, listSafeWindowsProcesses } from './system-tools.js';
import { objectSchema, ToolRegistry, type ToolSchema } from './tool-registry.js';

type ObjectValue = Record<string, unknown>;
const output = objectSchema<ObjectValue>(
  (value): value is ObjectValue => typeof value === 'object',
);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const bounded = (value: unknown, maximum: number): value is number =>
  positive(value) && (value as number) <= maximum;
const schema = <T extends ObjectValue>(validate: (value: ObjectValue) => boolean): ToolSchema<T> =>
  objectSchema<T>((value): value is T => validate(value));

interface PathLimit extends ObjectValue {
  path: string;
  maxBytes: number;
}
interface ListInput extends ObjectValue {
  path: string;
  maxEntries: number;
}
interface SearchInput extends ObjectValue {
  path: string;
  query: string;
  maxFiles: number;
  maxResults: number;
  maxFileBytes: number;
}
interface WriteInput extends ObjectValue {
  path: string;
  content: string;
  maxBytes: number;
}
interface CopyInput extends ObjectValue {
  source: string;
  destination: string;
  maxBytes: number;
}
interface MoveInput extends ObjectValue {
  source: string;
  destination: string;
}
interface PathInput extends ObjectValue {
  path: string;
}
interface ProcessInput extends ObjectValue {
  maxProcesses: number;
}
interface CaptureInput extends ObjectValue {
  target?: ScreenshotTarget;
  masks?: readonly MaskRectangle[];
  annotations?: readonly AnnotationRectangle[];
  retentionMs: number;
  maxImageBytes: number;
  maxPreviewBytes: number;
}

export interface FundamentalToolDependencies {
  readonly files: LocalFileTools;
  readonly screenshots: ScreenshotService;
  readonly processes?: (maxProcesses: number) => Promise<readonly ObjectValue[]>;
}

const limits = (
  timeoutMs: number,
  maxInputBytes = 64 * 1024,
  maxOutputBytes = 2 * 1024 * 1024,
) => ({ timeoutMs, maxInputBytes, maxOutputBytes });

export function createFundamentalToolRegistry(
  dependencies: FundamentalToolDependencies,
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'files.read',
    risk: 'LOW',
    limits: limits(10_000),
    input: schema<PathLimit>((v) => text(v.path) && bounded(v.maxBytes, 1024 * 1024)),
    output,
    execute: async (v) => dependencies.files.read(v.path, v.maxBytes),
  });
  registry.register({
    name: 'files.list',
    risk: 'LOW',
    limits: limits(10_000),
    input: schema<ListInput>((v) => text(v.path) && bounded(v.maxEntries, 10_000)),
    output,
    execute: async (v) => ({ entries: await dependencies.files.list(v.path, v.maxEntries) }),
  });
  registry.register({
    name: 'files.search',
    risk: 'LOW',
    limits: limits(30_000),
    input: schema<SearchInput>(
      (v) =>
        text(v.path) &&
        text(v.query) &&
        bounded(v.maxFiles, 10_000) &&
        bounded(v.maxResults, 1_000) &&
        bounded(v.maxFileBytes, 1024 * 1024),
    ),
    output,
    execute: async (v, context) => ({
      matches: await dependencies.files.search(v.path, v.query, v, context.signal),
    }),
  });
  registry.register({
    name: 'files.write',
    risk: 'MEDIUM',
    limits: limits(15_000, 2 * 1024 * 1024),
    input: schema<WriteInput>(
      (v) => text(v.path) && typeof v.content === 'string' && bounded(v.maxBytes, 2 * 1024 * 1024),
    ),
    output,
    execute: async (v) => ({ ...(await dependencies.files.write(v.path, v.content, v.maxBytes)) }),
  });
  registry.register({
    name: 'files.copy',
    risk: 'MEDIUM',
    limits: limits(30_000),
    input: schema<CopyInput>(
      (v) => text(v.source) && text(v.destination) && bounded(v.maxBytes, 100 * 1024 * 1024),
    ),
    output,
    execute: async (v) => ({
      ...(await dependencies.files.copy(v.source, v.destination, v.maxBytes)),
    }),
  });
  registry.register({
    name: 'files.move',
    risk: 'MEDIUM',
    limits: limits(30_000),
    input: schema<MoveInput>((v) => text(v.source) && text(v.destination)),
    output,
    execute: async (v) => ({ ...(await dependencies.files.move(v.source, v.destination)) }),
  });
  registry.register({
    name: 'files.remove',
    risk: 'MEDIUM',
    limits: limits(15_000),
    input: schema<PathInput>((v) => text(v.path)),
    output,
    execute: async (v) => dependencies.files.removeRecoverably(v.path),
  });
  registry.register({
    name: 'system.info',
    risk: 'LOW',
    limits: limits(5_000, 1_024, 32 * 1024),
    input: schema<ObjectValue>((v) => Object.keys(v).length === 0),
    output,
    execute: async () => collectSafeSystemInfo() as unknown as ObjectValue,
  });
  registry.register({
    name: 'system.processes',
    risk: 'LOW',
    limits: limits(15_000, 1_024, 512 * 1024),
    input: schema<ProcessInput>((v) => bounded(v.maxProcesses, 2_000)),
    output,
    execute: async (v) => ({
      processes: await (dependencies.processes ?? listSafeWindowsProcesses)(v.maxProcesses),
    }),
  });
  registry.register({
    name: 'screen.capture',
    risk: 'MEDIUM',
    limits: limits(35_000, 32 * 1024, 16 * 1024),
    input: schema<CaptureInput>(
      (v) =>
        bounded(v.retentionMs, 86_400_000) &&
        bounded(v.maxImageBytes, 50 * 1024 * 1024) &&
        bounded(v.maxPreviewBytes, 5 * 1024 * 1024) &&
        (v.target === undefined ||
          (typeof v.target === 'object' && v.target !== null && 'kind' in v.target)) &&
        (v.masks === undefined || Array.isArray(v.masks)) &&
        (v.annotations === undefined || Array.isArray(v.annotations)),
    ),
    output,
    execute: async (v) => ({ ...(await dependencies.screenshots.capture(v)) }),
  });
  return registry;
}
