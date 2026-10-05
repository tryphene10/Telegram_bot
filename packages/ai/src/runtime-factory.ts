import { EgressGateway, type EgressAuditSink, type EgressDestination } from '@arcc/security';
import { AiGateway, type AiRunAuditSink } from './ai-gateway.js';
import { ModelCatalog, type ModelDefinition } from './model-catalog.js';
import {
  AnthropicMessagesAdapter,
  DeepSeekAdapter,
  GatewayApprovedProviderTransport,
  MoonshotAdapter,
  MultiProviderDispatcher,
  OllamaAdapter,
  OpenAiResponsesAdapter,
  type SecureJsonTransport,
} from './provider-adapters.js';

export function createAiRuntime(input: {
  readonly models: readonly ModelDefinition[];
  readonly transport: SecureJsonTransport;
  readonly audit: AiRunAuditSink;
  readonly egressAudit: EgressAuditSink;
  readonly enabledCloudDestinations?: readonly Exclude<EgressDestination, 'LOCAL_MODEL'>[];
}): AiGateway {
  const transport = new GatewayApprovedProviderTransport(input.transport);
  const dispatcher = new MultiProviderDispatcher({
    LOCAL_MODEL: new OllamaAdapter(transport),
    OPENAI: new OpenAiResponsesAdapter(transport),
    ANTHROPIC: new AnthropicMessagesAdapter(transport),
    DEEPSEEK: new DeepSeekAdapter(transport),
    MOONSHOT: new MoonshotAdapter(transport),
  });
  const destinations: EgressDestination[] = [
    'LOCAL_MODEL',
    ...(input.enabledCloudDestinations ?? []),
  ];
  return new AiGateway(
    new ModelCatalog(input.models),
    new EgressGateway(destinations, dispatcher, input.egressAudit),
    input.audit,
  );
}
