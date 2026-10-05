import { describe, expect, it } from 'vitest';
import { definitions } from './model-catalog.fixture.js';
import { ModelCatalog, type ModelProvider } from './model-catalog.js';

describe('ModelCatalog', () => {
  it.each(definitions)('selects configured $provider model $id explicitly', (definition) => {
    expect(
      new ModelCatalog(definitions).resolve({
        default: { provider: definition.provider, model: definition.id },
      }),
    ).toBe(definition);
  });

  it('applies agent then mission then default precedence without substitution', () => {
    const catalog = new ModelCatalog(definitions);
    expect(
      catalog.resolve({
        default: { provider: 'OPENAI', model: 'gpt-requested' },
        mission: { provider: 'ANTHROPIC', model: 'claude-requested' },
        agent: { provider: 'DEEPSEEK', model: 'deepseek-requested' },
      }).provider,
    ).toBe('DEEPSEEK');
  });

  it('fails closed when a selected provider is disabled and only suggests local', () => {
    const disabled = definitions.map((model) =>
      model.provider === 'OPENAI' ? { ...model, enabled: false } : model,
    );
    expect(() =>
      new ModelCatalog(disabled).resolve({
        default: { provider: 'OPENAI' as ModelProvider, model: 'gpt-requested' },
      }),
    ).toThrow('provider_or_model_disabled');
  });
});
