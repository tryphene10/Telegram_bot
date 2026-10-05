export const MISSION_STATUSES = [
  'CREATED',
  'QUEUED',
  'PLANNING',
  'RUNNING',
  'WAITING_FOR_UI',
  'WAITING_FOR_USER',
  'RETRYING',
  'RECOVERING',
  'VERIFYING',
  'WAITING_APPROVAL',
  'PAUSED',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
] as const;

export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const APPROVAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const TOOL_EXECUTION_STATUSES = [
  'CREATED',
  'AUTHORIZED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type ToolExecutionStatus = (typeof TOOL_EXECUTION_STATUSES)[number];

export const MISSION_TRANSITIONS: Readonly<Record<MissionStatus, readonly MissionStatus[]>> = {
  CREATED: ['QUEUED', 'CANCELLED'],
  QUEUED: ['PLANNING', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  PLANNING: [
    'RUNNING',
    'WAITING_FOR_UI',
    'WAITING_FOR_USER',
    'PAUSED',
    'BLOCKED',
    'FAILED',
    'CANCELLED',
  ],
  RUNNING: [
    'WAITING_FOR_UI',
    'WAITING_FOR_USER',
    'RETRYING',
    'VERIFYING',
    'WAITING_APPROVAL',
    'PAUSED',
    'BLOCKED',
    'FAILED',
    'CANCELLED',
  ],
  WAITING_FOR_UI: ['RUNNING', 'WAITING_FOR_USER', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  WAITING_FOR_USER: ['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  RETRYING: [
    'RUNNING',
    'WAITING_FOR_UI',
    'WAITING_FOR_USER',
    'VERIFYING',
    'PAUSED',
    'BLOCKED',
    'FAILED',
    'CANCELLED',
  ],
  RECOVERING: ['QUEUED', 'RUNNING', 'WAITING_FOR_USER', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  VERIFYING: [
    'COMPLETED',
    'PARTIALLY_COMPLETED',
    'RUNNING',
    'RETRYING',
    'PAUSED',
    'BLOCKED',
    'FAILED',
    'CANCELLED',
  ],
  WAITING_APPROVAL: ['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  PAUSED: ['QUEUED', 'RUNNING', 'RECOVERING', 'CANCELLED'],
  BLOCKED: ['QUEUED', 'PLANNING', 'RUNNING', 'WAITING_FOR_USER', 'PAUSED', 'FAILED', 'CANCELLED'],
  FAILED: ['QUEUED', 'RETRYING', 'CANCELLED'],
  CANCELLED: [],
  COMPLETED: [],
  PARTIALLY_COMPLETED: [],
};

export const APPROVAL_TRANSITIONS: Readonly<Record<ApprovalStatus, readonly ApprovalStatus[]>> = {
  PENDING: ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export const TOOL_EXECUTION_TRANSITIONS: Readonly<
  Record<ToolExecutionStatus, readonly ToolExecutionStatus[]>
> = {
  CREATED: ['AUTHORIZED', 'FAILED', 'CANCELLED'],
  AUTHORIZED: ['RUNNING', 'FAILED', 'CANCELLED'],
  RUNNING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export class InvalidStateTransitionError extends Error {
  constructor(entity: string, from: string, to: string) {
    super(`Invalid ${entity} transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

function assertTransition<T extends string>(
  entity: string,
  transitions: Readonly<Record<T, readonly T[]>>,
  from: T,
  to: T,
): void {
  if (!transitions[from].includes(to)) {
    throw new InvalidStateTransitionError(entity, from, to);
  }
}

export function assertMissionTransition(from: MissionStatus, to: MissionStatus): void {
  assertTransition('mission', MISSION_TRANSITIONS, from, to);
}

export function assertApprovalTransition(from: ApprovalStatus, to: ApprovalStatus): void {
  assertTransition('approval', APPROVAL_TRANSITIONS, from, to);
}

export function assertToolExecutionTransition(
  from: ToolExecutionStatus,
  to: ToolExecutionStatus,
): void {
  assertTransition('tool execution', TOOL_EXECUTION_TRANSITIONS, from, to);
}
