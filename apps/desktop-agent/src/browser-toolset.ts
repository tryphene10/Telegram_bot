import {
  objectSchema,
  validateProjectManifest,
  type ProjectManifest,
  type ToolDefinition,
  type ToolRegistry,
  type ToolRisk,
} from '@arcc/tools';
import { type BrowserAction, type ControlledBrowserService } from './browser-service.js';

interface BrowserToolInput extends Record<string, unknown> {
  action: BrowserAction;
  url: string;
  parameters?: Readonly<Record<string, unknown>>;
  manifest?: ProjectManifest;
  downloadDestination?: string;
  maximumDownloadBytes?: number;
}

const actions = new Set<BrowserAction>([
  'OPEN',
  'READ',
  'EXTRACT',
  'DOWNLOAD',
  'UPLOAD',
  'FORM',
  'CLICK',
  'SEND',
  'PAY',
  'DELETE',
  'PUBLISH',
  'SENSITIVE_LOGIN',
]);

const inputSchema = objectSchema<BrowserToolInput>(
  (value): value is BrowserToolInput =>
    actions.has(value.action as BrowserAction) &&
    typeof value.url === 'string' &&
    (value.parameters === undefined ||
      (typeof value.parameters === 'object' &&
        value.parameters !== null &&
        !Array.isArray(value.parameters))),
);

const outputSchema = objectSchema<Record<string, unknown>>(
  (value): value is Record<string, unknown> => typeof value === 'object',
);

export function browserToolName(action: BrowserAction): string {
  if (['OPEN', 'READ', 'EXTRACT'].includes(action)) return 'browser.read';
  if (action === 'DOWNLOAD') return 'browser.download';
  if (action === 'UPLOAD') return 'browser.upload';
  if (['SEND', 'PAY', 'DELETE', 'PUBLISH', 'SENSITIVE_LOGIN'].includes(action))
    return 'browser.external';
  return 'browser.interact';
}

export function registerControlledBrowserTools(
  registry: ToolRegistry,
  browser: ControlledBrowserService,
  fixedManifest?: ProjectManifest,
): void {
  const definitions: readonly [string, ToolRisk][] = [
    ['browser.read', 'LOW'],
    ['browser.download', 'MEDIUM'],
    ['browser.interact', 'MEDIUM'],
    ['browser.upload', 'HIGH'],
    ['browser.external', 'CRITICAL'],
  ];
  for (const [name, risk] of definitions) {
    const definition: ToolDefinition<BrowserToolInput, Record<string, unknown>> = {
      name,
      risk,
      limits: { timeoutMs: 120_000, maxInputBytes: 256 * 1024, maxOutputBytes: 2 * 1024 * 1024 },
      input: inputSchema,
      output: outputSchema,
      execute: async (request, context) => {
        if (browserToolName(request.action) !== name)
          throw new Error('browser_action_risk_mismatch');
        const manifest =
          fixedManifest ??
          (request.manifest === undefined ? undefined : validateProjectManifest(request.manifest));
        return {
          ...(await browser.execute({
            action: request.action,
            url: request.url,
            ...(request.parameters === undefined ? {} : { parameters: request.parameters }),
            ...(manifest === undefined ? {} : { manifest }),
            ...(request.downloadDestination === undefined
              ? {}
              : { downloadDestination: request.downloadDestination }),
            ...(request.maximumDownloadBytes === undefined
              ? {}
              : { maximumDownloadBytes: request.maximumDownloadBytes }),
            registryAuthorization: context.authorization,
          })),
        };
      },
    };
    registry.register(definition);
  }
}
