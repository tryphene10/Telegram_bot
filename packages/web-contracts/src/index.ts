export const DASHBOARD_API_VERSION = 'v1' as const;
export type EntityKind =
  | 'users'
  | 'machines'
  | 'projects'
  | 'missions'
  | 'approvals'
  | 'agents'
  | 'models'
  | 'schedules'
  | 'incidents'
  | 'artifacts'
  | 'audit'
  | 'usage';
export type StatusTone = 'OK' | 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKED' | 'NEUTRAL';
export interface ApiErrorDto {
  readonly version: 'v1';
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly correlationId: string;
    readonly retryable: boolean;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}
export interface CursorPageDto<T> {
  readonly version: 'v1';
  readonly items: readonly T[];
  readonly nextCursor?: string;
  readonly correlationId: string;
}
export interface EntityDto {
  readonly id: string;
  readonly kind: EntityKind;
  readonly name: string;
  readonly status: string;
  readonly tone: StatusTone;
  readonly summary: Readonly<Record<string, string | number | boolean | null>>;
  readonly updatedAt: string;
}
export interface TimelineEventDto {
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly title: string;
  readonly status: string;
  readonly occurredAt: string;
}
export interface MissionDto extends EntityDto {
  readonly kind: 'missions';
  readonly project: string;
  readonly machine: string;
  readonly model: string;
  readonly progress: number;
  readonly timeline: readonly TimelineEventDto[];
}
export interface ApprovalDto extends EntityDto {
  readonly kind: 'approvals';
  readonly action: string;
  readonly project: string;
  readonly machine: string;
  readonly environment: string;
  readonly model: string;
  readonly risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly actionHash: string;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly expiresAt: string;
}
export interface OverviewDto {
  readonly version: 'v1';
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly health: readonly EntityDto[];
  readonly missions: readonly MissionDto[];
  readonly approvals: readonly ApprovalDto[];
  readonly incidents: readonly EntityDto[];
  readonly schedules: readonly EntityDto[];
  readonly usage: readonly EntityDto[];
  readonly activity: readonly TimelineEventDto[];
}
export interface DiagnosticDto {
  readonly version: 'v1';
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly components: readonly EntityDto[];
  readonly degraded: boolean;
  readonly exportSafe: boolean;
}
export interface RealtimeEventDto {
  readonly version: 'v1';
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly projection: Readonly<Record<string, string | number | boolean | null>>;
}
export interface MutationRequestDto {
  readonly action: string;
  readonly targetId: string;
  readonly expectedState: string;
  readonly actionHash?: string;
  readonly authorizationReference?: string;
  readonly input?: Readonly<Record<string, string | number | boolean | null>>;
}
export interface MutationResultDto {
  readonly version: 'v1';
  readonly correlationId: string;
  readonly status: 'COMPLETED' | 'WAITING_APPROVAL' | 'BLOCKED' | 'DENIED';
  readonly state: string;
  readonly message: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseMutationRequest(value: unknown): MutationRequestDto {
  if (
    !object(value) ||
    typeof value.action !== 'string' ||
    typeof value.targetId !== 'string' ||
    typeof value.expectedState !== 'string'
  )
    throw new Error('invalid_mutation_request');
  if (value.action.length > 64 || value.targetId.length > 128 || value.expectedState.length > 128)
    throw new Error('mutation_field_too_long');
  const optional = (key: string) => value[key] === undefined || typeof value[key] === 'string';
  if (
    !optional('actionHash') ||
    !optional('authorizationReference') ||
    (value.input !== undefined && !object(value.input))
  )
    throw new Error('invalid_mutation_request');
  return {
    action: value.action,
    targetId: value.targetId,
    expectedState: value.expectedState,
    ...(typeof value.actionHash === 'string' ? { actionHash: value.actionHash } : {}),
    ...(typeof value.authorizationReference === 'string'
      ? { authorizationReference: value.authorizationReference }
      : {}),
    ...(object(value.input)
      ? { input: value.input as Readonly<Record<string, string | number | boolean | null>> }
      : {}),
  };
}
export function boundedQuery(input: URLSearchParams) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(input.get('limit') ?? '25', 10) || 25));
  const sort = input.get('sort') ?? 'updatedAt';
  if (!['updatedAt', 'name', 'status'].includes(sort)) throw new Error('sort_not_allowed');
  const cursor = input.get('cursor') ?? undefined;
  if (cursor && !/^[A-Za-z0-9_-]{1,256}$/u.test(cursor)) throw new Error('invalid_cursor');
  return { limit, sort, ...(cursor ? { cursor } : {}) };
}
