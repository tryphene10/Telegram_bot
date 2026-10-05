import type { PolicyResult } from '@arcc/policies';
export type IncidentAction = 'INVESTIGATE' | 'RESTART' | 'IGNORE';
export interface IncidentContext {
  readonly id: string;
  readonly actionHash: string;
  readonly sensitive: boolean;
  readonly environment: 'LOCAL' | 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
  readonly restartCount: number;
  readonly maxRestarts: number;
  readonly cooldownUntil?: number;
}
export interface IncidentResponseStore {
  load(id: string): Promise<IncidentContext | undefined>;
  transition(
    id: string,
    action: IncidentAction,
    result: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}
export interface IncidentPolicyPort {
  evaluate(incident: IncidentContext, action: IncidentAction): Promise<PolicyResult>;
}
export interface IncidentSupervisorPort {
  investigate(id: string): Promise<Readonly<Record<string, unknown>>>;
  restart(id: string): Promise<Readonly<Record<string, unknown>>>;
}
export interface IncidentAuthorizationPort {
  consume(input: {
    readonly incidentId: string;
    readonly action: IncidentAction;
    readonly actionHash: string;
    readonly authorizationReference: string;
  }): Promise<boolean>;
}
export class IncidentResponseError extends Error {
  constructor(readonly reason: string) {
    super(`Incident action rejected: ${reason}`);
    this.name = 'IncidentResponseError';
  }
}
export class IncidentResponseService {
  constructor(
    private readonly store: IncidentResponseStore,
    private readonly policy: IncidentPolicyPort,
    private readonly supervisor: IncidentSupervisorPort,
    private readonly authorization: IncidentAuthorizationPort,
    private readonly now: () => number = Date.now,
  ) {}
  async respond(id: string, action: IncidentAction, authorizationReference?: string) {
    const incident = await this.store.load(id);
    if (!incident) throw new IncidentResponseError('incident_not_found');
    if (action === 'IGNORE') {
      await this.store.transition(id, action, { ignored: true });
      return { ignored: true };
    }
    const decision = await this.policy.evaluate(incident, action);
    if (decision.decision === 'DENY') throw new IncidentResponseError(decision.reason);
    const strong =
      incident.sensitive ||
      incident.environment === 'PRODUCTION' ||
      (action === 'RESTART' && decision.decision === 'REQUIRE_STRONG_APPROVAL');
    if (
      strong &&
      (!authorizationReference ||
        !(await this.authorization.consume({
          incidentId: id,
          action,
          actionHash: decision.actionHash,
          authorizationReference,
        })))
    )
      throw new IncidentResponseError('strong_fresh_approval_required');
    if (action === 'RESTART') {
      if (incident.restartCount >= incident.maxRestarts)
        throw new IncidentResponseError('restart_limit_reached');
      if (incident.cooldownUntil && incident.cooldownUntil > this.now())
        throw new IncidentResponseError('restart_cooldown_active');
    }
    const result =
      action === 'INVESTIGATE'
        ? await this.supervisor.investigate(id)
        : await this.supervisor.restart(id);
    await this.store.transition(id, action, { ...result, actionHash: decision.actionHash });
    return result;
  }
}
