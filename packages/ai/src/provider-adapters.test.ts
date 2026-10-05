import type { EgressRequest } from '@arcc/security';
import { describe, expect, it, vi } from 'vitest';
import {
  AnthropicMessagesAdapter,
  DeepSeekAdapter,
  MoonshotAdapter,
  MultiProviderDispatcher,
  OllamaAdapter,
  OpenAiResponsesAdapter,
  type ProviderHttpTransport,
} from './provider-adapters.js';

const base: EgressRequest = {
  destination: 'OPENAI',
  model: 'requested-model',
  correlationId: 'correlation',
  payload: { kind: 'USER_INSTRUCTION', classification: 'CLOUD_SAFE', content: 'hello' },
  maxOutputTokens: 123,
};

describe('provider adapters', () => {
  it('serializes OpenAI Responses with storage disabled', async () => {
    const send = vi.fn(async () => ({
      status: 200,
      body: {
        model: 'requested-model',
        output_text: 'answer',
        usage: { input_tokens: 2, output_tokens: 3 },
      },
    }));
    const result = await new OpenAiResponsesAdapter({ send } as ProviderHttpTransport).invoke(base);
    expect(result).toMatchObject({ body: 'answer', inputTokens: 2, outputTokens: 3 });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'OPENAI',
        credentialKey: 'OPENAI_API_KEY',
        body: { model: 'requested-model', input: 'hello', store: false, max_output_tokens: 123 },
      }),
    );
    expect(JSON.stringify(send.mock.calls)).not.toContain('sk-');
  });

  it('normalizes Anthropic, DeepSeek, Kimi and Ollama responses', async () => {
    const send = vi.fn(async ({ provider }) => {
      if (provider === 'ANTHROPIC') {
        return {
          status: 200,
          body: {
            model: 'requested-model',
            content: [{ type: 'text', text: 'claude' }],
            usage: {},
          },
        };
      }
      if (provider === 'LOCAL') {
        return {
          status: 200,
          body: { model: 'requested-model', message: { content: 'local' }, eval_count: 4 },
        };
      }
      return {
        status: 200,
        body: {
          model: 'requested-model',
          choices: [{ message: { content: provider } }],
          usage: {},
        },
      };
    });
    const transport = { send } as ProviderHttpTransport;
    await expect(
      new AnthropicMessagesAdapter(transport).invoke({ ...base, destination: 'ANTHROPIC' }),
    ).resolves.toMatchObject({ body: 'claude' });
    await expect(
      new DeepSeekAdapter(transport).invoke({ ...base, destination: 'DEEPSEEK' }),
    ).resolves.toMatchObject({ body: 'DEEPSEEK' });
    await expect(
      new MoonshotAdapter(transport).invoke({ ...base, destination: 'MOONSHOT' }),
    ).resolves.toMatchObject({ body: 'MOONSHOT' });
    await expect(
      new OllamaAdapter(transport).invoke({ ...base, destination: 'LOCAL_MODEL' }),
    ).resolves.toMatchObject({ body: 'local', outputTokens: 4 });
  });

  it('dispatches exactly once to the selected adapter and never substitutes', async () => {
    const invoke = vi.fn(async () => ({ body: 'ok' }));
    const dispatcher = new MultiProviderDispatcher({ OPENAI: { invoke } });
    await dispatcher.dispatch(base);
    expect(invoke).toHaveBeenCalledOnce();
    await expect(dispatcher.dispatch({ ...base, destination: 'ANTHROPIC' })).rejects.toThrow(
      'provider_not_configured',
    );
    expect(invoke).toHaveBeenCalledOnce();
  });
});
