import {
  objectSchema,
  type ToolContext,
  type ToolDefinition,
  type ToolRegistry,
  type ToolRisk,
} from '@arcc/tools';
import type {
  ComputerUseCore,
  ComputerUseRisk,
  DesktopAction,
  DesktopObservation,
} from './computer-use-core.js';

interface ObserveInput extends Record<string, unknown> {
  readonly missionId: string;
}

interface ActionInput extends Record<string, unknown> {
  readonly missionId: string;
  readonly action: DesktopAction;
}

export interface ComputerUseObserverPort {
  observe(signal?: AbortSignal): Promise<DesktopObservation>;
}

export interface ComputerUseExecutorPort {
  execute(input: Parameters<ComputerUseCore['execute']>[0]): ReturnType<ComputerUseCore['execute']>;
}

const observeSchema = objectSchema<ObserveInput>(
  (value): value is ObserveInput =>
    typeof value.missionId === 'string' && value.missionId.length > 0,
);

const actionKinds = new Set<DesktopAction['kind']>([
  'WINDOW_ACTIVATE',
  'WINDOW_MOVE_RESIZE',
  'WINDOW_STATE',
  'UIA_INVOKE',
  'UIA_SELECT',
  'UIA_TOGGLE',
  'UIA_EXPAND_COLLAPSE',
  'UIA_SET_VALUE',
  'INPUT_CLICK',
  'INPUT_TEXT',
]);

const actionSchema = objectSchema<ActionInput>(
  (value): value is ActionInput =>
    typeof value.missionId === 'string' &&
    typeof value.action === 'object' &&
    value.action !== null &&
    actionKinds.has(
      (value.action as { kind?: DesktopAction['kind'] }).kind as DesktopAction['kind'],
    ),
);

const outputSchema = objectSchema<Record<string, unknown>>(
  (value): value is Record<string, unknown> => typeof value === 'object' && value !== null,
);

const riskRank: Readonly<Record<ComputerUseRisk, number>> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function toolName(action: DesktopAction): 'computer.window' | 'computer.uia' | 'computer.input' {
  if (action.kind.startsWith('WINDOW_')) return 'computer.window';
  if (action.kind.startsWith('UIA_')) return 'computer.uia';
  return 'computer.input';
}

function minimumRisk(name: ReturnType<typeof toolName>): ComputerUseRisk {
  return name === 'computer.input' ? 'HIGH' : 'MEDIUM';
}

function actionDefinition(
  name: ReturnType<typeof toolName>,
  risk: ToolRisk,
  executor: ComputerUseExecutorPort,
): ToolDefinition<ActionInput, Record<string, unknown>> {
  return {
    name,
    risk,
    limits: { timeoutMs: 60_000, maxInputBytes: 128 * 1024, maxOutputBytes: 512 * 1024 },
    input: actionSchema,
    output: outputSchema,
    execute: async (request, context: ToolContext) => {
      if (toolName(request.action) !== name) throw new Error('computer_use_action_tool_mismatch');
      if (riskRank[request.action.risk] < riskRank[minimumRisk(name)]) {
        throw new Error('computer_use_risk_understated');
      }
      const result = await executor.execute({
        missionId: request.missionId,
        action: request.action,
        registryAuthorization: context.authorization,
        signal: context.signal,
      });
      return { ...result };
    },
  };
}

export function registerComputerUseTools(
  registry: ToolRegistry,
  observer: ComputerUseObserverPort,
  executor: ComputerUseExecutorPort,
): void {
  registry.register<ObserveInput, Record<string, unknown>>({
    name: 'computer.observe',
    risk: 'LOW',
    limits: { timeoutMs: 30_000, maxInputBytes: 4 * 1024, maxOutputBytes: 2 * 1024 * 1024 },
    input: observeSchema,
    output: outputSchema,
    execute: async (_request, context) => ({ ...(await observer.observe(context.signal)) }),
  });
  registry.register(actionDefinition('computer.window', 'CRITICAL', executor));
  registry.register(actionDefinition('computer.uia', 'CRITICAL', executor));
  registry.register(actionDefinition('computer.input', 'CRITICAL', executor));
}
