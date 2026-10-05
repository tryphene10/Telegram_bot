import type { ModelDefinition } from './model-catalog.js';

export const definitions: readonly ModelDefinition[] = (
  [
    ['LOCAL', 'local-code'],
    ['OPENAI', 'gpt-requested'],
    ['ANTHROPIC', 'claude-requested'],
    ['DEEPSEEK', 'deepseek-requested'],
    ['MOONSHOT', 'kimi-requested'],
  ] as const
).map(([provider, id]) => ({
  provider,
  id,
  enabled: true,
  available: true,
  contextTokens: 16_384,
  maximumOutputTokens: 2_048,
  maximumClassification: provider === 'LOCAL' ? 'SECRET' : 'CLOUD_SAFE',
  inputCostMicrounitsPerMillion: provider === 'LOCAL' ? 0 : 100,
  outputCostMicrounitsPerMillion: provider === 'LOCAL' ? 0 : 200,
  capabilities: { text: true, vision: false, tools: false, structuredOutput: true },
}));
