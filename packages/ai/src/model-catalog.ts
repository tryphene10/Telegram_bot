import type { DataClassification, EgressDestination } from '@arcc/security';

export const MODEL_PROVIDERS = ['LOCAL', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'MOONSHOT'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export interface ModelCapabilities {
  readonly text: boolean;
  readonly vision: boolean;
  readonly tools: boolean;
  readonly structuredOutput: boolean;
}

export interface ModelDefinition {
  readonly provider: ModelProvider;
  readonly id: string;
  readonly enabled: boolean;
  readonly available: boolean;
  readonly contextTokens: number;
  readonly maximumOutputTokens: number;
  readonly maximumClassification: 'CLOUD_SAFE' | 'SECRET';
  readonly inputCostMicrounitsPerMillion: number;
  readonly outputCostMicrounitsPerMillion: number;
  readonly capabilities: ModelCapabilities;
}

export interface ModelChoice {
  readonly provider: ModelProvider;
  readonly model: string;
}

export interface SelectionPreferences {
  readonly default: ModelChoice;
  readonly mission?: ModelChoice;
  readonly agent?: ModelChoice;
}

export class ModelSelectionError extends Error {
  constructor(
    readonly reason: string,
    readonly selected?: ModelChoice,
    readonly suggestedLocal?: ModelChoice,
  ) {
    super(`Model selection blocked: ${reason}`);
    this.name = 'ModelSelectionError';
  }
}

function key(choice: ModelChoice): string {
  return `${choice.provider}:${choice.model}`;
}

export class ModelCatalog {
  private readonly models: ReadonlyMap<string, ModelDefinition>;

  constructor(definitions: readonly ModelDefinition[]) {
    const entries = definitions.map((definition) => {
      if (
        !MODEL_PROVIDERS.includes(definition.provider) ||
        !definition.id.trim() ||
        definition.contextTokens < 1 ||
        definition.maximumOutputTokens < 1 ||
        definition.maximumOutputTokens > definition.contextTokens
      ) {
        throw new ModelSelectionError('invalid_model_definition');
      }
      return [key({ provider: definition.provider, model: definition.id }), definition] as const;
    });
    if (new Set(entries.map(([identifier]) => identifier)).size !== entries.length) {
      throw new ModelSelectionError('duplicate_model_definition');
    }
    this.models = new Map(entries);
  }

  resolve(preferences: SelectionPreferences): ModelDefinition {
    const selected = preferences.agent ?? preferences.mission ?? preferences.default;
    const model = this.models.get(key(selected));
    const local = this.firstAvailableLocal();
    if (!model) throw new ModelSelectionError('model_not_configured', selected, local);
    if (!model.enabled)
      throw new ModelSelectionError('provider_or_model_disabled', selected, local);
    if (!model.available) throw new ModelSelectionError('model_unavailable', selected, local);
    return model;
  }

  get(choice: ModelChoice): ModelDefinition | undefined {
    return this.models.get(key(choice));
  }

  list(): readonly ModelDefinition[] {
    return [...this.models.values()];
  }

  firstAvailableLocal(): ModelChoice | undefined {
    const model = [...this.models.values()].find(
      ({ provider, enabled, available }) => provider === 'LOCAL' && enabled && available,
    );
    return model ? { provider: model.provider, model: model.id } : undefined;
  }
}

export function providerDestination(provider: ModelProvider): EgressDestination {
  return provider === 'LOCAL' ? 'LOCAL_MODEL' : provider;
}

export function classificationCompatible(
  model: ModelDefinition,
  classification: DataClassification,
): boolean {
  if (classification === 'SECRET') return model.provider === 'LOCAL';
  if (classification === 'LOCAL_ONLY') return model.provider === 'LOCAL';
  return model.maximumClassification === 'SECRET' || model.maximumClassification === 'CLOUD_SAFE';
}
