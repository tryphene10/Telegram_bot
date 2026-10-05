import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import {
  classifyContent,
  markCloudSafeUserInstruction,
  type ContentKind,
  type DataClassification,
  type EgressGateway,
} from '@arcc/security';
import {
  classificationCompatible,
  type ModelCatalog,
  type ModelChoice,
  type ModelDefinition,
  ModelSelectionError,
  providerDestination,
  type SelectionPreferences,
} from './model-catalog.js';

export interface PromptPart {
  readonly kind: ContentKind;
  readonly content: string;
}

export interface AiBudget {
  readonly maximumInputBytes: number;
  readonly maximumOutputTokens: number;
  readonly maximumEstimatedCostMicrounits: number;
}

export interface AiRunAuditSink {
  record(event: {
    readonly correlationId: string;
    readonly missionId: string;
    readonly agentKey: string;
    readonly provider: string;
    readonly requestedModel: string;
    readonly returnedModel?: string;
    readonly classification: DataClassification;
    readonly status: 'COMPLETED' | 'FAILED' | 'BLOCKED';
    readonly latencyMs: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostMicrounits: number;
    readonly reason: string;
  }): Promise<void>;
}

export class AiGatewayError extends Error {
  constructor(
    readonly reason: string,
    readonly selected?: ModelChoice,
    readonly suggestedLocal?: ModelChoice,
    options?: ErrorOptions,
  ) {
    super(`AI gateway failed: ${reason}`, options);
    this.name = 'AiGatewayError';
  }
}

function promptClassification(
  parts: readonly PromptPart[],
  cloudSafeUserInstructionApproved: boolean,
): {
  readonly kind: ContentKind;
  readonly classification: DataClassification;
  readonly content: string;
} {
  if (parts.length === 0) throw new AiGatewayError('prompt_required');
  const classified = parts.map((part) =>
    part.kind === 'USER_INSTRUCTION' && cloudSafeUserInstructionApproved
      ? markCloudSafeUserInstruction(part.content)
      : classifyContent(part.kind, part.content),
  );
  const rank: Readonly<Record<DataClassification, number>> = {
    PUBLIC: 0,
    CLOUD_SAFE: 1,
    LOCAL_ONLY: 2,
    SECRET: 3,
  };
  const mostRestricted = classified.reduce((current, item) =>
    rank[item.classification] > rank[current.classification] ? item : current,
  );
  return {
    kind: mostRestricted.kind,
    classification: mostRestricted.classification,
    content: classified.map(({ kind, content }) => `[${kind}]\n${content}`).join('\n\n'),
  };
}

function estimateTokens(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / 4));
}

function estimateCost(model: ModelDefinition, inputTokens: number, outputTokens: number): number {
  return Math.ceil(
    (inputTokens * model.inputCostMicrounitsPerMillion +
      outputTokens * model.outputCostMicrounitsPerMillion) /
      1_000_000,
  );
}

export interface AiGenerationResult {
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly classification: DataClassification;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly estimatedCostMicrounits: number;
}

export class AiGateway {
  constructor(
    private readonly catalog: ModelCatalog,
    private readonly egress: EgressGateway,
    private readonly audit: AiRunAuditSink,
  ) {}

  async generate(input: {
    readonly correlationId: string;
    readonly missionId: string;
    readonly agentKey: string;
    readonly selection: SelectionPreferences;
    readonly parts: readonly PromptPart[];
    readonly cloudSafeUserInstructionApproved?: boolean;
    readonly budget: AiBudget;
    readonly signal?: AbortSignal;
  }): Promise<AiGenerationResult> {
    const started = performance.now();
    let model: ModelDefinition;
    try {
      model = this.catalog.resolve(input.selection);
    } catch (error) {
      if (error instanceof ModelSelectionError) {
        throw new AiGatewayError(error.reason, error.selected, error.suggestedLocal, {
          cause: error,
        });
      }
      throw error;
    }
    const selected = { provider: model.provider, model: model.id };
    const payload = promptClassification(
      input.parts,
      input.cloudSafeUserInstructionApproved ?? false,
    );
    const bytes = Buffer.byteLength(payload.content, 'utf8');
    const inputTokens = estimateTokens(bytes);
    const outputTokens = Math.min(input.budget.maximumOutputTokens, model.maximumOutputTokens);
    const estimatedCostMicrounits = estimateCost(model, inputTokens, outputTokens);
    const denial = !classificationCompatible(model, payload.classification)
      ? 'classification_incompatible_with_selected_model'
      : bytes > input.budget.maximumInputBytes
        ? 'input_budget_exceeded'
        : inputTokens + outputTokens > model.contextTokens
          ? 'context_budget_exceeded'
          : outputTokens < 1
            ? 'output_budget_required'
            : estimatedCostMicrounits > input.budget.maximumEstimatedCostMicrounits
              ? 'cost_budget_exceeded'
              : null;
    if (denial) {
      await this.audit.record({
        correlationId: input.correlationId,
        missionId: input.missionId,
        agentKey: input.agentKey,
        provider: model.provider,
        requestedModel: model.id,
        classification: payload.classification,
        status: 'BLOCKED',
        latencyMs: Math.round(performance.now() - started),
        inputTokens,
        outputTokens: 0,
        estimatedCostMicrounits: 0,
        reason: denial,
      });
      throw new AiGatewayError(denial, selected, this.catalog.firstAvailableLocal());
    }
    try {
      const response = await this.egress.send({
        destination: providerDestination(model.provider),
        model: model.id,
        correlationId: input.correlationId,
        payload,
        maxOutputTokens: outputTokens,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (response.returnedModel && response.returnedModel !== model.id) {
        throw new AiGatewayError(
          'provider_model_mismatch',
          selected,
          this.catalog.firstAvailableLocal(),
        );
      }
      const actualInputTokens = response.inputTokens ?? inputTokens;
      const actualOutputTokens =
        response.outputTokens ?? estimateTokens(Buffer.byteLength(response.body, 'utf8'));
      const actualCost = estimateCost(model, actualInputTokens, actualOutputTokens);
      const latencyMs = Math.round(performance.now() - started);
      await this.audit.record({
        correlationId: input.correlationId,
        missionId: input.missionId,
        agentKey: input.agentKey,
        provider: model.provider,
        requestedModel: model.id,
        ...(response.returnedModel === undefined ? {} : { returnedModel: response.returnedModel }),
        classification: payload.classification,
        status: 'COMPLETED',
        latencyMs,
        inputTokens: actualInputTokens,
        outputTokens: actualOutputTokens,
        estimatedCostMicrounits: actualCost,
        reason: 'selected_model_completed',
      });
      return {
        text: response.body,
        provider: model.provider,
        model: response.returnedModel ?? model.id,
        classification: payload.classification,
        inputTokens: actualInputTokens,
        outputTokens: actualOutputTokens,
        latencyMs,
        estimatedCostMicrounits: actualCost,
      };
    } catch (error) {
      await this.audit.record({
        correlationId: input.correlationId,
        missionId: input.missionId,
        agentKey: input.agentKey,
        provider: model.provider,
        requestedModel: model.id,
        classification: payload.classification,
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - started),
        inputTokens,
        outputTokens: 0,
        estimatedCostMicrounits: 0,
        reason: error instanceof AiGatewayError ? error.reason : 'selected_model_failed',
      });
      if (error instanceof AiGatewayError) throw error;
      throw new AiGatewayError(
        'selected_model_failed',
        selected,
        this.catalog.firstAvailableLocal(),
        {
          cause: error,
        },
      );
    }
  }
}
