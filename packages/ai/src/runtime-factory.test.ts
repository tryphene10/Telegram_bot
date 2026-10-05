import { describe, expect, it, vi } from 'vitest';
import { definitions } from './model-catalog.fixture.js';
import { createAiRuntime } from './runtime-factory.js';

const budget = {
  maximumInputBytes: 10_000,
  maximumOutputTokens: 100,
  maximumEstimatedCostMicrounits: 1_000,
};

describe('createAiRuntime', () => {
  it('keeps every cloud destination disabled by default', async () => {
    const send = vi.fn();
    const runtime = createAiRuntime({
      models: definitions,
      transport: { send },
      audit: { record: vi.fn() },
      egressAudit: { record: vi.fn() },
    });
    await expect(
      runtime.generate({
        correlationId: 'correlation',
        missionId: 'mission',
        agentKey: 'agent',
        selection: { default: { provider: 'OPENAI', model: 'gpt-requested' } },
        parts: [{ kind: 'USER_INSTRUCTION', content: 'public question' }],
        cloudSafeUserInstructionApproved: true,
        budget,
      }),
    ).rejects.toThrow('selected_model_failed');
    expect(send).not.toHaveBeenCalled();
  });

  it('makes the configured local Ollama runtime immediately selectable', async () => {
    const send = vi.fn(async () => ({
      status: 200,
      body: { model: 'local-code', message: { content: 'local answer' }, eval_count: 3 },
    }));
    const runtime = createAiRuntime({
      models: definitions,
      transport: { send },
      audit: { record: vi.fn() },
      egressAudit: { record: vi.fn() },
    });
    await expect(
      runtime.generate({
        correlationId: 'correlation',
        missionId: 'mission',
        agentKey: 'agent',
        selection: { default: { provider: 'LOCAL', model: 'local-code' } },
        parts: [{ kind: 'CODE', content: 'const local = true;' }],
        budget,
      }),
    ).resolves.toMatchObject({ text: 'local answer', provider: 'LOCAL', model: 'local-code' });
  });
});
