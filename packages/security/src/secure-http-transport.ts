import type { EgressDestination } from './egress-gateway.js';

export interface CredentialResolver {
  resolve(key: string): Promise<string>;
}

export interface SecureJsonRequest {
  readonly destination: EgressDestination;
  readonly url: string;
  readonly credentialKey?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface SecureJsonResponse {
  readonly status: number;
  readonly body: unknown;
}

type FetchLike = (
  input: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{ readonly status: number; json(): Promise<unknown> }>;

export class SecureHttpTransportError extends Error {
  constructor(readonly reason: string) {
    super(`Secure HTTP transport denied: ${reason}`);
    this.name = 'SecureHttpTransportError';
  }
}

export class AllowlistedJsonHttpTransport {
  constructor(
    private readonly endpoints: Readonly<Partial<Record<EgressDestination, readonly string[]>>>,
    private readonly credentials: CredentialResolver,
    private readonly fetcher: FetchLike = globalThis.fetch,
  ) {}

  async send(request: SecureJsonRequest): Promise<SecureJsonResponse> {
    const allowed = this.endpoints[request.destination] ?? [];
    if (!allowed.includes(request.url))
      throw new SecureHttpTransportError('endpoint_not_allowlisted');
    const parsed = new URL(request.url);
    if (
      request.destination === 'LOCAL_MODEL'
        ? parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
        : parsed.protocol !== 'https:'
    ) {
      throw new SecureHttpTransportError('insecure_or_nonlocal_endpoint');
    }
    const headers: Record<string, string> = { ...request.headers };
    if (request.credentialKey) {
      const credential = await this.credentials.resolve(request.credentialKey);
      if (!credential) throw new SecureHttpTransportError('credential_unavailable');
      if (request.destination === 'ANTHROPIC') headers['x-api-key'] = credential;
      else headers.authorization = `Bearer ${credential}`;
    } else if (request.destination !== 'LOCAL_MODEL') {
      throw new SecureHttpTransportError('cloud_credential_required');
    }
    const response = await this.fetcher(request.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request.body),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return { status: response.status, body: await response.json() };
  }
}
