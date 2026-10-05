import { timingSafeEqual } from 'node:crypto';
import type { ModelChoice } from '@arcc/ai';
import type {
  DeterministicPlanner,
  DeterministicStepExecutor,
  StepOutcome,
} from './mission-engine.js';
import type { MissionAggregate, MissionStep, MissionStepPlan } from './mission-runtime.js';
import {
  buildSpecialistPrompt,
  SPECIALIST_KEYS,
  SPECIALIST_PROFILES,
  type AgentRunBudget,
  type SpecialistKey,
  type UntrustedArtifact,
} from './specialists.js';

export interface MissionTarget {
  readonly projectId: string;
  readonly machineId: string;
}

export interface MissionTargetResolver {
  resolve(mission: MissionAggregate): Promise<MissionTarget>;
}

export interface MissionModelSelection {
  forAgent(mission: MissionAggregate, agent: SpecialistKey | 'SUPERVISOR'): ModelChoice;
}

export interface SupervisorKnowledgePort {
  search(input: {
    readonly projectId: string;
    readonly missionId: string;
    readonly query: string;
    readonly critical: true;
  }): Promise<
    Readonly<{
      results: readonly Readonly<{
        excerpt: string;
        citation: Readonly<{
          uri: string;
          relativePath: string;
          section: string;
          sourceHash: string;
          freshness: string;
        }>;
      }>[];
      mode: 'HYBRID' | 'LEXICAL_ONLY';
    }>
  >;
}

export interface SupervisorPlanSource {
  plan(input: {
    readonly missionId: string;
    readonly objective: string;
    readonly untrustedContext: Readonly<Record<string, unknown>>;
    readonly target: MissionTarget;
    readonly model: ModelChoice;
  }): Promise<{
    readonly returnedModel: ModelChoice;
    readonly steps: readonly SupervisorPlanStep[];
  }>;
}

interface SupervisorPlanStepBase {
  readonly id: string;
  readonly title: string;
  readonly dependencies: readonly string[];
  readonly maxAttempts?: number;
  readonly maxLoops?: number;
  readonly maximumToolCalls?: number;
  readonly exitCriteria: readonly string[];
}

export type SupervisorPlanStep = SupervisorPlanStepBase &
  (
    | Readonly<{
        executionKind?: 'SPECIALIST';
        agentKey: SpecialistKey;
        requestedModel?: ModelChoice;
      }>
    | Readonly<{
        executionKind: 'ADAPTIVE_DESKTOP';
        adaptivePlanId: string;
      }>
  );

export interface AgentActionProposal {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly rationale: string;
}

export interface AgentProposal {
  readonly summary: string;
  readonly actions: readonly AgentActionProposal[];
  readonly facts: readonly string[];
  readonly hypotheses: readonly string[];
  readonly risks: readonly string[];
}

export interface SpecialistProposalSource {
  propose(input: {
    readonly missionId: string;
    readonly stepId: string;
    readonly agent: SpecialistKey;
    readonly model: ModelChoice;
    readonly prompt: string;
    readonly budget: AgentRunBudget;
    readonly signal: AbortSignal;
  }): Promise<{ readonly returnedModel: ModelChoice; readonly proposal: unknown }>;
}

export interface SupervisorPolicyPort {
  evaluate(input: {
    readonly mission: MissionAggregate;
    readonly step: MissionStep;
    readonly agent: SpecialistKey;
    readonly tool: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  }): Promise<{
    readonly decision: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | 'REQUIRE_STRONG_APPROVAL';
    readonly actionHash: string;
    readonly authorizationId?: string;
    readonly reason: string;
  }>;
}

export interface SupervisorToolPort {
  execute(input: {
    readonly tool: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly authorization: {
      readonly decision: 'ALLOW';
      readonly actionHash: string;
      readonly authorizationId?: string;
    };
    readonly signal: AbortSignal;
  }): Promise<unknown>;
}

export interface ModelChangeDecisionPort {
  decide(input: {
    readonly missionId: string;
    readonly stepId: string;
    readonly selected: ModelChoice;
    readonly requested: ModelChoice;
  }): Promise<
    | { readonly status: 'APPROVED' }
    | { readonly status: 'PENDING'; readonly approvalId: string }
    | { readonly status: 'DENIED'; readonly reason: string }
  >;
}

export class SupervisorValidationError extends Error {
  constructor(readonly reason: string) {
    super(`Supervisor validation failed: ${reason}`);
    this.name = 'SupervisorValidationError';
  }
}

function sameModel(left: ModelChoice, right: ModelChoice): boolean {
  const leftValue = Buffer.from(`${left.provider}:${left.model}`);
  const rightValue = Buffer.from(`${right.provider}:${right.model}`);
  return leftValue.length === rightValue.length && timingSafeEqual(leftValue, rightValue);
}

function stringList(value: unknown, field: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((item) => typeof item !== 'string')
  ) {
    throw new SupervisorValidationError(`invalid_${field}`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SupervisorValidationError('invalid_proposal');
  }
  return value as Record<string, unknown>;
}

export function validateAgentProposal(
  raw: unknown,
  agent: SpecialistKey,
  budget: AgentRunBudget,
): AgentProposal {
  const value = record(raw);
  if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 4_000) {
    throw new SupervisorValidationError('invalid_summary');
  }
  if (!Array.isArray(value.actions) || value.actions.length > budget.maximumToolCalls) {
    throw new SupervisorValidationError('tool_budget_exceeded');
  }
  const allowed = SPECIALIST_PROFILES[agent].allowedTools;
  const actions = value.actions.map((rawAction) => {
    const action = record(rawAction);
    if (
      typeof action.tool !== 'string' ||
      !allowed.has(action.tool) ||
      typeof action.rationale !== 'string' ||
      !action.rationale.trim()
    ) {
      throw new SupervisorValidationError('agent_tool_not_allowed');
    }
    return {
      tool: action.tool,
      input: record(action.input),
      rationale: action.rationale.trim(),
    };
  });
  return {
    summary: value.summary.trim(),
    actions,
    facts: stringList(value.facts ?? [], 'facts'),
    hypotheses: stringList(value.hypotheses ?? [], 'hypotheses'),
    risks: stringList(value.risks ?? [], 'risks'),
  };
}

function artifactsFrom(mission: MissionAggregate): readonly UntrustedArtifact[] {
  const value = mission.definition.context.artifacts;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    if (
      !['README', 'PDF', 'WEB_PAGE', 'TOOL_OUTPUT'].includes(String(candidate.kind)) ||
      typeof candidate.source !== 'string' ||
      typeof candidate.content !== 'string'
    ) {
      return [];
    }
    return [candidate as unknown as UntrustedArtifact];
  });
}

export class PolicyControlledSupervisorPlanner implements DeterministicPlanner {
  constructor(
    private readonly source: SupervisorPlanSource,
    private readonly targets: MissionTargetResolver,
    private readonly models: MissionModelSelection,
    private readonly knowledge?: SupervisorKnowledgePort,
  ) {}

  async plan(mission: MissionAggregate): Promise<readonly MissionStepPlan[]> {
    const target = await this.targets.resolve(mission);
    if (target.projectId !== mission.definition.projectId || !target.machineId.trim()) {
      throw new SupervisorValidationError('mission_target_mismatch');
    }
    const model = this.models.forAgent(mission, 'SUPERVISOR');
    let untrustedContext: Readonly<Record<string, unknown>> = mission.definition.context;
    if (this.knowledge) {
      const memory = await this.knowledge.search({
        projectId: mission.definition.projectId,
        missionId: mission.id,
        query: mission.definition.objective,
        critical: true,
      });
      untrustedContext = {
        ...mission.definition.context,
        localKnowledge: {
          mode: memory.mode,
          trust: 'DATA_ONLY',
          status: 'REFERENCE_ONLY',
          results: memory.results.map(({ excerpt, citation }) => ({ excerpt, citation })),
        },
      };
    }
    const generated = await this.source.plan({
      missionId: mission.id,
      objective: mission.definition.objective,
      untrustedContext,
      target,
      model,
    });
    if (!sameModel(model, generated.returnedModel)) {
      throw new SupervisorValidationError('supervisor_model_substitution');
    }
    if (generated.steps.length === 0 || generated.steps.length > 50) {
      throw new SupervisorValidationError('invalid_supervisor_plan_size');
    }
    return generated.steps.map((step) => {
      if (step.executionKind === 'ADAPTIVE_DESKTOP') {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(step.adaptivePlanId)) {
          throw new SupervisorValidationError('invalid_adaptive_plan_reference');
        }
        return {
          id: step.id,
          title: step.title,
          dependencies: step.dependencies,
          executionKind: 'ADAPTIVE_DESKTOP' as const,
          adaptivePlanId: step.adaptivePlanId,
          maxAttempts: step.maxAttempts ?? 2,
          maxLoops: step.maxLoops ?? 2,
          maximumToolCalls: step.maximumToolCalls ?? 100,
          exitCriteria: step.exitCriteria,
        };
      }
      if (!SPECIALIST_KEYS.includes(step.agentKey)) {
        throw new SupervisorValidationError('unknown_specialist');
      }
      const budget = SPECIALIST_PROFILES[step.agentKey].defaultBudget;
      const maxLoops = step.maxLoops ?? budget.maximumIterations;
      if (maxLoops > budget.maximumIterations) {
        throw new SupervisorValidationError('iteration_budget_exceeded');
      }
      return {
        id: step.id,
        title: step.title,
        dependencies: step.dependencies,
        agentKey: step.agentKey,
        ...(step.requestedModel === undefined ? {} : { requestedModel: step.requestedModel }),
        maxAttempts: step.maxAttempts ?? 2,
        maxLoops,
        maximumToolCalls: step.maximumToolCalls ?? budget.maximumToolCalls,
        exitCriteria: step.exitCriteria,
      };
    });
  }
}

export class PolicyControlledSpecialistExecutor implements DeterministicStepExecutor {
  constructor(
    private readonly proposals: SpecialistProposalSource,
    private readonly models: MissionModelSelection,
    private readonly modelChanges: ModelChangeDecisionPort,
    private readonly policy: SupervisorPolicyPort,
    private readonly tools: SupervisorToolPort,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: {
    readonly mission: MissionAggregate;
    readonly step: MissionStep;
    readonly signal: AbortSignal;
  }): Promise<StepOutcome> {
    const agent = input.step.agentKey;
    if (!agent || !SPECIALIST_KEYS.includes(agent as SpecialistKey)) {
      return { status: 'BLOCKED', cause: 'unknown_specialist', expectedAction: 'Corriger le plan' };
    }
    const specialist = agent as SpecialistKey;
    const profile = SPECIALIST_PROFILES[specialist];
    const selected = this.models.forAgent(input.mission, specialist);
    let model = selected;
    if (
      input.step.requestedModel &&
      !sameModel(selected, input.step.requestedModel as ModelChoice)
    ) {
      const decision = await this.modelChanges.decide({
        missionId: input.mission.id,
        stepId: input.step.id,
        selected,
        requested: input.step.requestedModel as ModelChoice,
      });
      if (decision.status === 'PENDING') {
        return { status: 'WAITING_APPROVAL', approvalId: decision.approvalId };
      }
      if (decision.status === 'DENIED') {
        return {
          status: 'BLOCKED',
          cause: 'model_change_denied',
          expectedAction: decision.reason,
        };
      }
      model = input.step.requestedModel as ModelChoice;
    }
    const budget: AgentRunBudget = {
      ...profile.defaultBudget,
      maximumToolCalls: Math.min(
        input.step.maximumToolCalls ?? profile.defaultBudget.maximumToolCalls,
        profile.defaultBudget.maximumToolCalls,
      ),
      maximumIterations: Math.min(input.step.maxLoops, profile.defaultBudget.maximumIterations),
    };
    const started = this.now();
    try {
      const generated = await this.proposals.propose({
        missionId: input.mission.id,
        stepId: input.step.id,
        agent: specialist,
        model,
        prompt: buildSpecialistPrompt({
          profile,
          objective: input.mission.definition.objective,
          step: input.step.title,
          model,
          artifacts: artifactsFrom(input.mission),
        }),
        budget,
        signal: input.signal,
      });
      if (!sameModel(model, generated.returnedModel)) {
        return {
          status: 'BLOCKED',
          cause: 'specialist_model_substitution',
          expectedAction: 'Choisir explicitement un modele disponible',
        };
      }
      const proposal = validateAgentProposal(generated.proposal, specialist, budget);
      const actions: { tool: string; output: unknown }[] = [];
      for (const action of proposal.actions) {
        if (input.signal.aborted || this.now() - started > budget.maximumWallClockMs) {
          return {
            status: 'BLOCKED',
            cause: 'agent_budget_exhausted',
            expectedAction: 'Reduire la tache ou augmenter explicitement son budget',
          };
        }
        const authorization = await this.policy.evaluate({
          mission: input.mission,
          step: input.step,
          agent: specialist,
          tool: action.tool,
          parameters: action.input,
        });
        if (authorization.decision === 'DENY') {
          return {
            status: 'BLOCKED',
            cause: `policy_denied:${authorization.reason}`,
            expectedAction: 'Modifier le plan ou la politique explicite',
          };
        }
        if (authorization.decision !== 'ALLOW') {
          return {
            status: 'WAITING_APPROVAL',
            approvalId: authorization.authorizationId ?? authorization.actionHash,
          };
        }
        const output = await this.tools.execute({
          tool: action.tool,
          parameters: action.input,
          authorization: {
            decision: 'ALLOW',
            actionHash: authorization.actionHash,
            ...(authorization.authorizationId === undefined
              ? {}
              : { authorizationId: authorization.authorizationId }),
          },
          signal: input.signal,
        });
        actions.push({ tool: action.tool, output });
      }
      return {
        status: 'COMPLETED',
        result: {
          agent: specialist,
          model,
          summary: proposal.summary,
          facts: proposal.facts,
          hypotheses: proposal.hypotheses,
          risks: proposal.risks,
          actions,
        },
      };
    } catch (error) {
      if (error instanceof SupervisorValidationError) {
        return {
          status: 'BLOCKED',
          cause: error.reason,
          expectedAction: 'Corriger la proposition de l agent sans elargir ses permissions',
        };
      }
      return {
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'specialist_execution_failed',
        retryable: !input.signal.aborted,
      };
    }
  }
}
