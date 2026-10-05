import {
  objectSchema,
  type CompiledTerminalProfile,
  type ToolDefinition,
  type ToolRegistry,
  type ToolRisk,
} from '@arcc/tools';
import type { SecureTerminalRunner } from './terminal-runner.js';

interface TerminalInput extends Record<string, unknown> {
  profile: string;
  environment?: Readonly<Record<string, string>>;
}

const input = objectSchema<TerminalInput>(
  (value): value is TerminalInput =>
    typeof value.profile === 'string' &&
    /^[a-z][a-z0-9._-]{0,63}$/u.test(value.profile) &&
    (value.environment === undefined ||
      (typeof value.environment === 'object' &&
        value.environment !== null &&
        !Array.isArray(value.environment) &&
        Object.entries(value.environment).every(
          ([name, item]) =>
            /^[A-Z][A-Z0-9_]{0,63}$/u.test(name) &&
            typeof item === 'string' &&
            item.length <= 16_384,
        ))),
);

const output = objectSchema<Record<string, unknown>>(
  (value): value is Record<string, unknown> => typeof value === 'object',
);

export function terminalToolName(profile: CompiledTerminalProfile): string {
  if (profile.network === 'ALLOW') return 'terminal.network';
  if (profile.kind === 'DEPENDENCY_INSTALL') return 'terminal.install';
  if (profile.kind === 'PERSISTENT_PROCESS') return 'terminal.persistent';
  return profile.mutatesProject ? 'terminal.mutate' : 'terminal.readonly';
}

export function registerSecureTerminalTools(
  registry: ToolRegistry,
  dependencies: {
    readonly resolveProfile: (name: string) => Promise<CompiledTerminalProfile>;
    readonly runner: SecureTerminalRunner;
  },
): void {
  const definitions: readonly [string, ToolRisk][] = [
    ['terminal.readonly', 'LOW'],
    ['terminal.mutate', 'MEDIUM'],
    ['terminal.install', 'HIGH'],
    ['terminal.persistent', 'MEDIUM'],
    ['terminal.network', 'HIGH'],
  ];
  for (const [name, risk] of definitions) {
    const definition: ToolDefinition<TerminalInput, Record<string, unknown>> = {
      name,
      risk,
      limits: { timeoutMs: 900_000, maxInputBytes: 64 * 1024, maxOutputBytes: 10 * 1024 * 1024 },
      input,
      output,
      execute: async (request, context) => {
        const profile = await dependencies.resolveProfile(request.profile);
        if (terminalToolName(profile) !== name) throw new Error('terminal_profile_risk_mismatch');
        const environment = request.environment;
        return {
          ...(await dependencies.runner.execute({
            profile,
            signal: context.signal,
            ...(environment === undefined ? {} : { environment }),
          })),
        };
      },
    };
    registry.register(definition);
  }
}
