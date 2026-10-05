import { EgressGateway, SecretRedactor, type EgressDispatcher } from '@arcc/security';
import { describe, expect, it, vi } from 'vitest';
import { AiGateway } from './ai-gateway.js';
import { ModelCatalog, type ModelProvider } from './model-catalog.js';
import { definitions } from './model-catalog.fixture.js';

const cloudProviders = ['OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'MOONSHOT'] as const;
const modelByProvider: Record<ModelProvider, string> = {
  LOCAL: 'local-code',
  OPENAI: 'gpt-requested',
  ANTHROPIC: 'claude-requested',
  DEEPSEEK: 'deepseek-requested',
  MOONSHOT: 'kimi-requested',
};

function harness(
  dispatch = vi.fn(async (request) => ({
    body: 'answer',
    returnedModel: request.model,
    inputTokens: 4,
    outputTokens: 2,
  })),
) {
  const audit = { record: vi.fn(async () => undefined) };
  const egressAudit = { record: vi.fn(async () => undefined) };
  const gateway = new EgressGateway(
    ['LOCAL_MODEL', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'MOONSHOT'],
    { dispatch } as EgressDispatcher,
    egressAudit,
    new SecretRedactor(['AI-CANARY-SECRET']),
  );
  return {
    ai: new AiGateway(new ModelCatalog(definitions), gateway, audit),
    dispatch,
    audit,
    egressAudit,
  };
}

function request(provider: ModelProvider, kind: 'USER_INSTRUCTION' | 'CODE' = 'USER_INSTRUCTION') {
  return {
    correlationId: 'correlation',
    missionId: 'mission',
    agentKey: 'planner',
    selection: { default: { provider, model: modelByProvider[provider] } },
    parts: [{ kind, content: kind === 'CODE' ? 'LOCAL-CODE-CANARY' : 'Explain a public concept' }],
    cloudSafeUserInstructionApproved: true,
    budget: {
      maximumInputBytes: 10_000,
      maximumOutputTokens: 100,
      maximumEstimatedCostMicrounits: 1_000,
    },
  } as const;
}

describe('AiGateway', () => {
  it.each(cloudProviders)('sends zero project code bytes to %s', async (provider) => {
    const values = harness();
    await expect(values.ai.generate(request(provider, 'CODE'))).rejects.toThrow(
      'classification_incompatible_with_selected_model',
    );
    expect(values.dispatch).not.toHaveBeenCalled();
  });

  it.each(cloudProviders)('honours explicit CLOUD_SAFE selection for %s', async (provider) => {
    const values = harness();
    const result = await values.ai.generate(request(provider));
    expect(result).toMatchObject({
      provider,
      model: modelByProvider[provider],
      classification: 'CLOUD_SAFE',
    });
    expect(values.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ model: modelByProvider[provider] }),
    );
  });

  it('routes code to an explicitly selected local model', async () => {
    const values = harness();
    await expect(values.ai.generate(request('LOCAL', 'CODE'))).resolves.toMatchObject({
      provider: 'LOCAL',
      model: 'local-code',
      classification: 'LOCAL_ONLY',
    });
  });

  it('never falls back when the selected provider fails', async () => {
    const dispatch = vi.fn(async () => {
      throw new Error('provider down');
    });
    const values = harness(dispatch);
    await expect(values.ai.generate(request('ANTHROPIC'))).rejects.toMatchObject({
      reason: 'selected_model_failed',
      selected: { provider: 'ANTHROPIC', model: 'claude-requested' },
      suggestedLocal: { provider: 'LOCAL', model: 'local-code' },
    });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('rejects a provider-reported model substitution', async () => {
    const values = harness(vi.fn(async () => ({ body: 'answer', returnedModel: 'another-model' })));
    await expect(values.ai.generate(request('OPENAI'))).rejects.toThrow('provider_model_mismatch');
  });

  it('audits exact model and metrics without prompt content', async () => {
    const values = harness();
    await values.ai.generate(request('DEEPSEEK'));
    expect(values.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'DEEPSEEK',
        requestedModel: 'deepseek-requested',
        inputTokens: 4,
        outputTokens: 2,
      }),
    );
    expect(JSON.stringify(values.audit.record.mock.calls)).not.toContain(
      'Explain a public concept',
    );
  });

  it('blocks secret canaries before any provider adapter', async () => {
    const values = harness();
    await expect(
      values.ai.generate({
        ...request('LOCAL'),
        parts: [{ kind: 'USER_INSTRUCTION', content: 'AI-CANARY-SECRET' }],
      }),
    ).rejects.toThrow('selected_model_failed');
    expect(values.dispatch).not.toHaveBeenCalled();
  });
});
