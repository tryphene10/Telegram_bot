import type {
  ApiErrorDto,
  EntityDto,
  EntityKind,
  DiagnosticDto,
  MutationRequestDto,
  MutationResultDto,
  OverviewDto,
} from '@arcc/web-contracts';
export class DashboardApiError extends Error {
  constructor(
    readonly code: string,
    readonly correlationId: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'DashboardApiError';
  }
}
export class DashboardApiClient {
  private csrf?: string;
  constructor(private readonly base = '') {}
  async authenticate(pin: string) {
    const result = await this.request<{ csrfToken: string }>('/api/v1/session', {
      method: 'POST',
      body: JSON.stringify({ pin }),
      headers: { 'content-type': 'application/json' },
    });
    this.csrf = result.csrfToken;
  }
  async rotateSession() {
    const result = await this.request<{ csrfToken: string }>('/api/v1/session/rotate', {
      method: 'POST',
      headers: { 'x-csrf-token': this.csrf ?? '' },
    });
    this.csrf = result.csrfToken;
  }
  overview() {
    return this.request<OverviewDto>('/api/v1/overview');
  }
  diagnostic() {
    return this.request<DiagnosticDto>('/api/v1/diagnostic');
  }
  list(kind: EntityKind, cursor?: string) {
    const query = new URLSearchParams({ limit: '25', sort: 'updatedAt' });
    if (cursor) query.set('cursor', cursor);
    return this.request<{ items: readonly EntityDto[]; nextCursor?: string }>(
      `/api/v1/entities/${kind}?${query}`,
    );
  }
  action(input: MutationRequestDto) {
    return this.request<MutationResultDto>('/api/v1/actions', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json', 'x-csrf-token': this.csrf ?? '' },
    });
  }
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.base}${path}`, { ...init, credentials: 'same-origin' });
    const value = (await response.json()) as T | ApiErrorDto;
    if (!response.ok) {
      const error = (value as ApiErrorDto).error;
      throw new DashboardApiError(
        error?.code ?? 'request_failed',
        error?.correlationId ?? response.headers.get('x-correlation-id') ?? 'unknown',
        error?.retryable ?? false,
      );
    }
    return value as T;
  }
}
