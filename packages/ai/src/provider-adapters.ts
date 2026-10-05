import type { EgressDispatcher, EgressRequest, EgressResponse } from '@arcc/security';
import type { ModelProvider } from './model-catalog.js';

export interface ProviderHttpRequest {
  readonly provider: ModelProvider;
  readonly url: string;
  readonly credentialKey?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface ProviderHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface ProviderHttpTransport {
  send(request: ProviderHttpRequest): Promise<ProviderHttpResponse>;
}

export interface SecureJsonTransport {
  send(request: {
    readonly destination: EgressRequest['destination'];
    readonly url: string;
    readonly credentialKey?: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Readonly<Record<string, unknown>>;
    readonly signal?: AbortSignal;
  }): Promise<ProviderHttpResponse>;
}

export class GatewayApprovedProviderTransport implements ProviderHttpTransport {
  constructor(private readonly transport: SecureJsonTransport) {}

  send(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
    return this.transport.send({
      destination: request.provider === 'LOCAL' ? 'LOCAL_MODEL' : request.provider,
      url: request.url,
      ...(request.credentialKey === undefined ? {} : { credentialKey: request.credentialKey }),
      headers: request.headers,
      body: request.body,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  }
}

export class ProviderAdapterError extends Error {
  constructor(readonly reason: string) {
    super(`Provider adapter failed: ${reason}`);
    this.name = 'ProviderAdapterError';
  }
}

interface Adapter {
  invoke(request: EgressRequest): Promise<EgressResponse>;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderAdapterError('invalid_provider_response');
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

abstract class HttpAdapter implements Adapter {
  constructor(
    protected readonly transport: ProviderHttpTransport,
    protected readonly endpoint: string,
    protected readonly provider: ModelProvider,
    protected readonly credentialKey?: string,
  ) {}

  abstract invoke(request: EgressRequest): Promise<EgressResponse>;

  protected async send(
    request: EgressRequest,
    body: Readonly<Record<string, unknown>>,
    headers: Readonly<Record<string, string>>,
  ): Promise<Record<string, unknown>> {
    const response = await this.transport.send({
      provider: this.provider,
      url: this.endpoint,
      ...(this.credentialKey === undefined ? {} : { credentialKey: this.credentialKey }),
      headers,
      body,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new ProviderAdapterError(`http_${response.status}`);
    }
    return record(response.body);
  }
}

export class OpenAiResponsesAdapter extends HttpAdapter {
  constructor(transport: ProviderHttpTransport, endpoint = 'https://api.openai.com/v1/responses') {
    super(transport, endpoint, 'OPENAI', 'OPENAI_API_KEY');
  }

  async invoke(request: EgressRequest): Promise<EgressResponse> {
    const body = await this.send(
      request,
      {
        model: request.model,
        input: request.payload.content,
        store: false,
        ...(request.maxOutputTokens === undefined
          ? {}
          : { max_output_tokens: request.maxOutputTokens }),
      },
      { 'content-type': 'application/json' },
    );
    let text = typeof body.output_text === 'string' ? body.output_text : '';
    if (!text && Array.isArray(body.output)) {
      text = body.output
        .flatMap((item) => (record(item).content as unknown[]) ?? [])
        .map((item) => record(item).text)
        .filter((item): item is string => typeof item === 'string')
        .join('');
    }
    const usage = isUsage(body.usage) ? body.usage : {};
    if (!text) throw new ProviderAdapterError('empty_provider_response');
    return {
      body: text,
      ...(typeof body.model === 'string' ? { returnedModel: body.model } : {}),
      ...(positiveInteger(usage.input_tokens) === undefined
        ? {}
        : { inputTokens: positiveInteger(usage.input_tokens) }),
      ...(positiveInteger(usage.output_tokens) === undefined
        ? {}
        : { outputTokens: positiveInteger(usage.output_tokens) }),
    };
  }
}

function isUsage(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class AnthropicMessagesAdapter extends HttpAdapter {
  constructor(
    transport: ProviderHttpTransport,
    endpoint = 'https://api.anthropic.com/v1/messages',
  ) {
    super(transport, endpoint, 'ANTHROPIC', 'ANTHROPIC_API_KEY');
  }

  async invoke(request: EgressRequest): Promise<EgressResponse> {
    const body = await this.send(
      request,
      {
        model: request.model,
        max_tokens: request.maxOutputTokens ?? 1_024,
        messages: [{ role: 'user', content: request.payload.content }],
      },
      { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    );
    const text = Array.isArray(body.content)
      ? body.content
          .map((item) => record(item).text)
          .filter((item): item is string => typeof item === 'string')
          .join('')
      : '';
    const usage = isUsage(body.usage) ? body.usage : {};
    if (!text) throw new ProviderAdapterError('empty_provider_response');
    return {
      body: text,
      ...(typeof body.model === 'string' ? { returnedModel: body.model } : {}),
      ...(positiveInteger(usage.input_tokens) === undefined
        ? {}
        : { inputTokens: positiveInteger(usage.input_tokens) }),
      ...(positiveInteger(usage.output_tokens) === undefined
        ? {}
        : { outputTokens: positiveInteger(usage.output_tokens) }),
    };
  }
}

class OpenAiCompatibleChatAdapter extends HttpAdapter {
  async invoke(request: EgressRequest): Promise<EgressResponse> {
    const body = await this.send(
      request,
      {
        model: request.model,
        messages: [{ role: 'user', content: request.payload.content }],
        ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
      },
      { 'content-type': 'application/json' },
    );
    const choice = Array.isArray(body.choices) ? record(body.choices[0]) : {};
    const message = isUsage(choice.message) ? choice.message : {};
    const usage = isUsage(body.usage) ? body.usage : {};
    if (typeof message.content !== 'string' || !message.content) {
      throw new ProviderAdapterError('empty_provider_response');
    }
    return {
      body: message.content,
      ...(typeof body.model === 'string' ? { returnedModel: body.model } : {}),
      ...(positiveInteger(usage.prompt_tokens) === undefined
        ? {}
        : { inputTokens: positiveInteger(usage.prompt_tokens) }),
      ...(positiveInteger(usage.completion_tokens) === undefined
        ? {}
        : { outputTokens: positiveInteger(usage.completion_tokens) }),
    };
  }
}

export class DeepSeekAdapter extends OpenAiCompatibleChatAdapter {
  constructor(
    transport: ProviderHttpTransport,
    endpoint = 'https://api.deepseek.com/chat/completions',
  ) {
    super(transport, endpoint, 'DEEPSEEK', 'DEEPSEEK_API_KEY');
  }
}

export class MoonshotAdapter extends OpenAiCompatibleChatAdapter {
  constructor(
    transport: ProviderHttpTransport,
    endpoint = 'https://api.moonshot.ai/v1/chat/completions',
  ) {
    super(transport, endpoint, 'MOONSHOT', 'MOONSHOT_API_KEY');
  }
}

export class OllamaAdapter extends HttpAdapter {
  constructor(transport: ProviderHttpTransport, endpoint = 'http://127.0.0.1:11434/api/chat') {
    super(transport, endpoint, 'LOCAL');
  }

  async invoke(request: EgressRequest): Promise<EgressResponse> {
    const body = await this.send(
      request,
      {
        model: request.model,
        stream: false,
        messages: [{ role: 'user', content: request.payload.content }],
        options: { num_predict: request.maxOutputTokens ?? 1_024 },
      },
      { 'content-type': 'application/json' },
    );
    const message = isUsage(body.message) ? body.message : {};
    if (typeof message.content !== 'string' || !message.content) {
      throw new ProviderAdapterError('empty_provider_response');
    }
    return {
      body: message.content,
      ...(typeof body.model === 'string' ? { returnedModel: body.model } : {}),
      ...(positiveInteger(body.prompt_eval_count) === undefined
        ? {}
        : { inputTokens: positiveInteger(body.prompt_eval_count) }),
      ...(positiveInteger(body.eval_count) === undefined
        ? {}
        : { outputTokens: positiveInteger(body.eval_count) }),
    };
  }
}

export class MultiProviderDispatcher implements EgressDispatcher {
  private readonly adapters: ReadonlyMap<string, Adapter>;

  constructor(adapters: Readonly<Partial<Record<EgressRequest['destination'], Adapter>>>) {
    this.adapters = new Map(Object.entries(adapters));
  }

  async dispatch(request: EgressRequest): Promise<EgressResponse> {
    const adapter = this.adapters.get(request.destination);
    if (!adapter) throw new ProviderAdapterError('provider_not_configured');
    return await adapter.invoke(request);
  }
}
