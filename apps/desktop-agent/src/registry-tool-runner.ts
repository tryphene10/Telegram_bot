import type { ToolRegistry } from '@arcc/tools';
import type { DisabledByDefaultToolRunner, ToolExecutionRequest } from './execution-gate.js';

export class RegistryToolRunner implements DisabledByDefaultToolRunner {
  constructor(private readonly registry: ToolRegistry) {}

  async run(request: ToolExecutionRequest): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.registry.execute(request.tool, request.parameters, {
      decision: request.policyDecision,
      actionHash: request.actionHash,
      authorizationId: request.authorizationId,
    });
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new Error('Tool output must be an object');
    }
    return result as Readonly<Record<string, unknown>>;
  }
}
