import { createHash, randomUUID } from 'node:crypto';
import { assertMissionTransition, type MissionStatus } from '@arcc/database';

export type MissionStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'BLOCKED'
  | 'FAILED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'SKIPPED';

export interface MissionDefinition {
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly objective: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly successCriteria: readonly string[];
  readonly definitionOfDone: readonly string[];
}

export interface MissionStepPlan {
  readonly id: string;
  readonly title: string;
  readonly dependencies: readonly string[];
  readonly maxAttempts: number;
  readonly maxLoops: number;
  readonly exitCriteria: readonly string[];
  readonly agentKey?: string;
  readonly requestedModel?: {
    readonly provider: string;
    readonly model: string;
  };
  readonly maximumToolCalls?: number;
  readonly executionKind?: 'SPECIALIST' | 'ADAPTIVE_DESKTOP';
  readonly adaptivePlanId?: string;
}

export interface MissionStep extends MissionStepPlan {
  readonly status: MissionStepStatus;
  readonly attempts: number;
  readonly loops: number;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly error?: string;
  readonly activeActionKey?: string | undefined;
  readonly activeActionHash?: string | undefined;
}

export interface MissionEvent {
  readonly sequence: number;
  readonly type: string;
  readonly at: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface MissionAggregate {
  readonly id: string;
  readonly submissionSequence: number;
  readonly definitionHash: string;
  readonly definition: MissionDefinition;
  readonly status: MissionStatus;
  readonly plan: readonly MissionStep[];
  readonly version: number;
  readonly executionEpoch: number;
  readonly leaseOwner?: string | undefined;
  readonly leaseUntil?: number | undefined;
  readonly blocked?: { readonly cause: string; readonly expectedAction: string } | undefined;
  readonly verificationEvidence: readonly string[];
  readonly finalReport?: string | undefined;
  readonly timeline: readonly MissionEvent[];
}

export interface ActionReceipt {
  readonly key: string;
  readonly actionHash: string;
  readonly result: Readonly<Record<string, unknown>>;
}

export class MissionRuntimeError extends Error {
  constructor(readonly reason: string) {
    super(`Mission runtime error: ${reason}`);
    this.name = 'MissionRuntimeError';
  }
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function normalizeList(values: readonly string[], field: string): readonly string[] {
  const normalized = values.map((value) => value.trim().replace(/\s+/gu, ' ')).filter(Boolean);
  if (normalized.length === 0 || normalized.some((value) => value.length > 2_000)) {
    throw new MissionRuntimeError(`${field}_required`);
  }
  return [...new Set(normalized)];
}

export function normalizeMissionDefinition(input: MissionDefinition): MissionDefinition {
  const objective = input.objective.trim().replace(/\s+/gu, ' ');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/u.test(input.idempotencyKey)) {
    throw new MissionRuntimeError('invalid_idempotency_key');
  }
  if (!input.projectId || !objective || objective.length > 10_000) {
    throw new MissionRuntimeError('objective_and_project_required');
  }
  return {
    ...input,
    objective,
    successCriteria: normalizeList(input.successCriteria, 'success_criteria'),
    definitionOfDone: normalizeList(input.definitionOfDone, 'definition_of_done'),
  };
}

export function validateMissionPlan(plan: readonly MissionStepPlan[]): readonly MissionStep[] {
  if (plan.length === 0 || plan.length > 200) throw new MissionRuntimeError('invalid_plan_size');
  const identifiers = new Set(plan.map(({ id }) => id));
  if (
    identifiers.size !== plan.length ||
    [...identifiers].some((id) => !/^[a-z][a-z0-9_-]{0,63}$/u.test(id))
  ) {
    throw new MissionRuntimeError('invalid_or_duplicate_step_id');
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(plan.map((step) => [step.id, step]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new MissionRuntimeError('cyclic_step_dependencies');
    if (visited.has(id)) return;
    visiting.add(id);
    const step = byId.get(id);
    if (!step) throw new MissionRuntimeError('unknown_step_dependency');
    for (const dependency of step.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const step of plan) {
    if (
      !step.title.trim() ||
      step.maxAttempts < 1 ||
      step.maxAttempts > 20 ||
      step.maxLoops < 1 ||
      step.maxLoops > 20 ||
      step.exitCriteria.length === 0 ||
      step.dependencies.includes(step.id) ||
      (step.agentKey !== undefined && !/^[A-Z][A-Z_]{2,63}$/u.test(step.agentKey)) ||
      (step.maximumToolCalls !== undefined &&
        (!Number.isSafeInteger(step.maximumToolCalls) ||
          step.maximumToolCalls < 1 ||
          step.maximumToolCalls > 100)) ||
      (step.executionKind === 'ADAPTIVE_DESKTOP' &&
        (step.agentKey !== undefined ||
          !step.adaptivePlanId ||
          !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(step.adaptivePlanId))) ||
      (step.executionKind !== 'ADAPTIVE_DESKTOP' && step.adaptivePlanId !== undefined)
    ) {
      throw new MissionRuntimeError('invalid_step');
    }
    visit(step.id);
  }
  return plan.map((step) => ({ ...step, status: 'PENDING', attempts: 0, loops: 0 }));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryDurableMissionStore {
  private readonly missions = new Map<string, MissionAggregate>();
  private readonly byKey = new Map<string, string>();
  private readonly receipts = new Map<string, ActionReceipt>();
  private readonly projectLeases = new Map<
    string,
    { missionId: string; owner: string; until: number }
  >();
  private sequence = 0;

  constructor(private readonly now: () => number = Date.now) {}

  create(definitionInput: MissionDefinition): MissionAggregate {
    const definition = normalizeMissionDefinition(definitionInput);
    const definitionHash = hash(definition);
    const existingId = this.byKey.get(definition.idempotencyKey);
    if (existingId) {
      const existing = this.missions.get(existingId);
      if (!existing || existing.definitionHash !== definitionHash) {
        throw new MissionRuntimeError('mission_idempotency_conflict');
      }
      return clone(existing);
    }
    const id = randomUUID();
    const aggregate: MissionAggregate = {
      id,
      submissionSequence: ++this.sequence,
      definitionHash,
      definition,
      status: 'QUEUED',
      plan: [],
      version: 1,
      executionEpoch: 0,
      verificationEvidence: [],
      timeline: [this.event(1, 'MISSION_QUEUED', {})],
    };
    this.missions.set(id, aggregate);
    this.byKey.set(definition.idempotencyKey, id);
    return clone(aggregate);
  }

  get(id: string): MissionAggregate {
    const value = this.missions.get(id);
    if (!value) throw new MissionRuntimeError('mission_not_found');
    return clone(value);
  }

  claimNext(worker: string, leaseMs: number): MissionAggregate | null {
    this.recoverExpired();
    const candidate = [...this.missions.values()]
      .filter(({ status }) => status === 'QUEUED')
      .sort((left, right) => left.submissionSequence - right.submissionSequence)[0];
    if (!candidate) return null;
    const projectLease = this.projectLeases.get(candidate.definition.projectId);
    if (
      projectLease &&
      projectLease.until > this.now() &&
      projectLease.missionId !== candidate.id
    ) {
      return null;
    }
    assertMissionTransition(candidate.status, 'PLANNING');
    const claimed = this.update(
      candidate,
      {
        status: 'PLANNING',
        executionEpoch: candidate.executionEpoch + 1,
        leaseOwner: worker,
        leaseUntil: this.now() + leaseMs,
      },
      'MISSION_CLAIMED',
      { worker },
    );
    this.projectLeases.set(candidate.definition.projectId, {
      missionId: claimed.id,
      owner: worker,
      until: this.now() + leaseMs,
    });
    return clone(claimed);
  }

  save(
    current: MissionAggregate,
    changes: Partial<MissionAggregate>,
    eventType: string,
    detail: Readonly<Record<string, unknown>> = {},
  ): MissionAggregate {
    const stored = this.missions.get(current.id);
    if (!stored || stored.version !== current.version)
      throw new MissionRuntimeError('concurrent_mission_update');
    if (changes.status && changes.status !== current.status)
      assertMissionTransition(current.status, changes.status);
    return clone(this.update(stored, changes, eventType, detail));
  }

  receipt(key: string): ActionReceipt | undefined {
    const value = this.receipts.get(key);
    return value ? clone(value) : undefined;
  }

  completeAction(receipt: ActionReceipt): void {
    const existing = this.receipts.get(receipt.key);
    if (existing && existing.actionHash !== receipt.actionHash) {
      throw new MissionRuntimeError('action_idempotency_conflict');
    }
    this.receipts.set(receipt.key, clone(receipt));
  }

  release(mission: MissionAggregate): void {
    const lease = this.projectLeases.get(mission.definition.projectId);
    if (lease?.missionId === mission.id) this.projectLeases.delete(mission.definition.projectId);
  }

  renewLease(id: string, worker: string, leaseMs: number): void {
    const mission = this.missions.get(id);
    if (!mission || mission.leaseOwner !== worker)
      throw new MissionRuntimeError('mission_lease_lost');
    const until = this.now() + leaseMs;
    this.missions.set(id, { ...mission, leaseUntil: until });
    this.projectLeases.set(mission.definition.projectId, { missionId: id, owner: worker, until });
  }

  recoverExpired(): number {
    let recovered = 0;
    for (const mission of this.missions.values()) {
      if (
        ['PLANNING', 'RUNNING', 'VERIFYING'].includes(mission.status) &&
        mission.leaseUntil !== undefined &&
        mission.leaseUntil <= this.now()
      ) {
        const recoveredMission = this.update(
          mission,
          { status: 'QUEUED', leaseOwner: undefined, leaseUntil: undefined },
          'MISSION_RECOVERED',
          {},
          true,
        );
        this.missions.set(mission.id, recoveredMission);
        this.release(recoveredMission);
        recovered += 1;
      }
    }
    return recovered;
  }

  private update(
    current: MissionAggregate,
    changes: Partial<MissionAggregate>,
    eventType: string,
    detail: Readonly<Record<string, unknown>>,
    recovery = false,
  ): MissionAggregate {
    if (!recovery && changes.status && changes.status !== current.status) {
      assertMissionTransition(current.status, changes.status);
    }
    const next: MissionAggregate = {
      ...current,
      ...changes,
      version: current.version + 1,
      timeline: [...current.timeline, this.event(current.timeline.length + 1, eventType, detail)],
    };
    this.missions.set(current.id, next);
    return next;
  }

  private event(
    sequence: number,
    type: string,
    detail: Readonly<Record<string, unknown>>,
  ): MissionEvent {
    return { sequence, type, detail, at: new Date(this.now()).toISOString() };
  }
}
