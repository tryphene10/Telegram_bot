import { Buffer } from 'node:buffer';

export type ToolRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AttachedPolicyDecision =
  'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | 'REQUIRE_STRONG_APPROVAL';

export interface ToolAuthorization {
  readonly decision: AttachedPolicyDecision;
  readonly actionHash: string;
  readonly authorizationId?: string;
}

export interface ToolLimits {
  readonly timeoutMs: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}

export interface ToolSchema<T> {
  parse(value: unknown): T;
}

export interface ToolContext {
  readonly signal: AbortSignal;
  readonly authorization: ToolAuthorization;
}

export interface ToolDefinition<TInput, TOutput> {
  readonly name: string;
  readonly risk: ToolRisk;
  readonly limits: ToolLimits;
  readonly input: ToolSchema<TInput>;
  readonly output: ToolSchema<TOutput>;
  readonly precondition?: (input: TInput) => Promise<void>;
  readonly execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
}

export class ToolRegistryError extends Error {
  constructor(readonly reason: string) {
    super(`Tool execution denied: ${reason}`);
    this.name = 'ToolRegistryError';
  }
}

function encodedSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    throw new ToolRegistryError('value_not_serializable');
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();

  register<TInput, TOutput>(definition: ToolDefinition<TInput, TOutput>): void {
    if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u.test(definition.name)) {
      throw new ToolRegistryError('invalid_tool_name');
    }
    if (
      !Number.isSafeInteger(definition.limits.timeoutMs) ||
      definition.limits.timeoutMs < 1 ||
      !Number.isSafeInteger(definition.limits.maxInputBytes) ||
      definition.limits.maxInputBytes < 1 ||
      !Number.isSafeInteger(definition.limits.maxOutputBytes) ||
      definition.limits.maxOutputBytes < 1
    ) {
      throw new ToolRegistryError('invalid_limits');
    }
    if (this.tools.has(definition.name)) throw new ToolRegistryError('duplicate_tool');
    this.tools.set(definition.name, definition as ToolDefinition<unknown, unknown>);
  }

  descriptors(): readonly Readonly<{
    name: string;
    risk: ToolRisk;
    limits: ToolLimits;
  }>[] {
    return [...this.tools.values()].map(({ name, risk, limits }) => ({ name, risk, limits }));
  }

  async execute(
    name: string,
    rawInput: unknown,
    authorization: ToolAuthorization,
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolRegistryError('tool_not_registered');
    if (!/^[a-f0-9]{64}$/u.test(authorization.actionHash)) {
      throw new ToolRegistryError('invalid_action_hash');
    }
    if (authorization.decision === 'DENY') throw new ToolRegistryError('policy_denied');
    if (
      authorization.decision !== 'ALLOW' &&
      (typeof authorization.authorizationId !== 'string' || !authorization.authorizationId)
    ) {
      throw new ToolRegistryError('approval_not_consumed');
    }
    if (encodedSize(rawInput) > tool.limits.maxInputBytes) {
      throw new ToolRegistryError('input_too_large');
    }
    let input: unknown;
    try {
      input = tool.input.parse(rawInput);
    } catch {
      throw new ToolRegistryError('invalid_input');
    }
    await tool.precondition?.(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), tool.limits.timeoutMs);
    timer.unref?.();
    try {
      const rawOutput = await Promise.race([
        tool.execute(input, { signal: controller.signal, authorization }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new ToolRegistryError('timeout')),
            { once: true },
          );
        }),
      ]);
      let output: unknown;
      try {
        output = tool.output.parse(rawOutput);
      } catch {
        throw new ToolRegistryError('invalid_output');
      }
      if (encodedSize(output) > tool.limits.maxOutputBytes) {
        throw new ToolRegistryError('output_too_large');
      }
      return output;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function objectSchema<T extends Record<string, unknown>>(
  validate: (value: Record<string, unknown>) => value is T,
): ToolSchema<T> {
  return {
    parse(value: unknown): T {
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        !validate(value as Record<string, unknown>)
      ) {
        throw new Error('schema_validation_failed');
      }
      return value as T;
    },
  };
}
