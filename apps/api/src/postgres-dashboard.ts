import { basename } from 'node:path';
import type { Pool } from 'pg';
import {
  PolicyEngine,
  type ActionCategory,
  type PolicyInput,
  type RiskLevel,
} from '@arcc/policies';
import type {
  ApprovalDto,
  CursorPageDto,
  DiagnosticDto,
  EntityDto,
  EntityKind,
  MissionDto,
  MutationRequestDto,
  MutationResultDto,
  OverviewDto,
  RealtimeEventDto,
  StatusTone,
} from '@arcc/web-contracts';
import type { DashboardApplicationPort, HttpAuditPort } from './dashboard-server.js';

type Row = Record<string, unknown>;

const table: Readonly<Record<EntityKind, string>> = {
  users: 'users',
  machines: 'machines',
  projects: 'projects',
  missions: 'missions',
  approvals: 'approvals',
  agents: 'agents',
  models: 'model_catalog',
  schedules: 'scheduled_tasks',
  incidents: 'incidents',
  artifacts: 'artifacts',
  audit: 'audit_logs',
  usage: 'model_usage',
};

function tone(status: string): StatusTone {
  if (['ACTIVE', 'ONLINE', 'COMPLETED', 'APPROVED', 'AVAILABLE', 'READY'].includes(status))
    return 'OK';
  if (['FAILED', 'OFFLINE', 'REVOKED', 'CRITICAL', 'ERROR'].includes(status)) return 'ERROR';
  if (['BLOCKED', 'CANCELLED'].includes(status)) return 'BLOCKED';
  if (['WAITING_APPROVAL', 'PENDING', 'WARNING'].includes(status)) return 'WARNING';
  return 'INFO';
}

function entity(kind: EntityKind, row: Row): EntityDto {
  const status = String(row.status ?? 'AVAILABLE');
  const rawName = String(
    row.name ??
      row.display_name ??
      row.agent_key ??
      row.model ??
      row.action ??
      row.title ??
      row.public_id ??
      kind,
  );
  return {
    id: String(row.public_id ?? row.id),
    kind,
    name: kind === 'projects' ? rawName : rawName.slice(0, 160),
    status,
    tone: tone(status),
    summary: (row.summary as Record<string, string | number | boolean | null> | undefined) ?? {},
    updatedAt: new Date(
      String(row.updated_at ?? row.occurred_at ?? row.created_at ?? Date.now()),
    ).toISOString(),
  };
}

function cursorOffset(cursor?: string) {
  if (!cursor) return 0;
  const parsed = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export class PostgresHttpAudit implements HttpAuditPort {
  constructor(private readonly pool: Pool) {}
  async record(event: Readonly<Record<string, unknown>>) {
    const correlationId = String(event.correlationId ?? '00000000-0000-0000-0000-000000000000');
    await this.pool.query(
      `select append_audit_log('HTTP',$1,$2::uuid,$3::jsonb,$4::jsonb,null,null,null,null,null,null,null,null,$5)`,
      [
        String(event.route ?? 'unknown').slice(0, 200),
        correlationId,
        JSON.stringify({ method: event.method, outcome: event.outcome }),
        JSON.stringify({ status: event.status }),
        Number(event.durationMs ?? 0),
      ],
    );
  }
}

export class PostgresDashboardApplication implements DashboardApplicationPort {
  private readonly policy: PolicyEngine;
  constructor(private readonly pool: Pool) {
    this.policy = new PolicyEngine({
      record: async (event) => {
        await this.pool.query(
          `select append_audit_log('POLICY',$1,gen_random_uuid(),$2::jsonb,$3::jsonb,$4)`,
          [
            event.tool,
            JSON.stringify({ actionHash: event.actionHash }),
            JSON.stringify({ decision: event.decision, reason: event.reason }),
            event.risk,
          ],
        );
      },
    });
  }

  async list(
    kind: EntityKind,
    query: { limit: number; sort: string; cursor?: string },
    correlationId: string,
  ): Promise<CursorPageDto<EntityDto>> {
    const offset = cursorOffset(query.cursor);
    const source = table[kind];
    const sort =
      query.sort === 'name'
        ? kind === 'users'
          ? 'display_name'
          : kind === 'agents'
            ? 'agent_key'
            : kind === 'models'
              ? 'model'
              : kind === 'audit'
                ? 'action'
                : kind === 'usage'
                  ? 'provider'
                  : 'name'
        : query.sort === 'status' && !['usage', 'audit', 'models'].includes(kind)
          ? 'status'
          : kind === 'audit' || kind === 'usage'
            ? 'occurred_at'
            : kind === 'artifacts'
              ? 'created_at'
              : 'updated_at';
    const result = await this.pool.query<Row>(
      `select *, '{}'::jsonb summary from ${source} order by ${sort} desc, id desc limit $1 offset $2`,
      [query.limit + 1, offset],
    );
    const rows = result.rows.slice(0, query.limit);
    return {
      version: 'v1',
      items: rows.map((row) => entity(kind, row)),
      ...(result.rows.length > query.limit
        ? { nextCursor: Buffer.from(String(offset + query.limit)).toString('base64url') }
        : {}),
      correlationId,
    };
  }

  async overview(correlationId: string): Promise<OverviewDto> {
    const [missions, approvals, incidents, schedules, usage, activity] = await Promise.all([
      this.pool.query<Row>(
        `select m.public_id,m.status,m.updated_at,coalesce(m.context->>'title','Mission '||left(m.public_id::text,8)) name,coalesce(p.name,'Sans projet') project,coalesce(mc.name,'Non assignée') machine,coalesce(m.requested_model,'Non sélectionné') model,coalesce((select round(100.0*count(*) filter(where status in('COMPLETED','SKIPPED'))/nullif(count(*),0)) from mission_steps where mission_id=m.id),0) progress from missions m left join projects p on p.id=m.project_id left join machines mc on mc.id=m.machine_id where m.status not in('COMPLETED','CANCELLED') order by m.updated_at desc limit 25`,
      ),
      this.pool.query<Row>(
        `select a.public_id,a.action_key,a.action_hash,a.parameters_sanitized,a.level,a.status,a.expires_at,a.created_at,coalesce(p.name,'Sans projet') project,coalesce(mc.name,'Non assignée') machine,coalesce(m.requested_model,'Non sélectionné') model from approvals a join missions m on m.id=a.mission_id left join projects p on p.id=m.project_id left join machines mc on mc.id=m.machine_id where a.status='PENDING' and a.expires_at>now() order by a.expires_at limit 25`,
      ),
      this.pool.query<Row>(
        `select i.public_id,i.incident_key name,i.status,i.severity,i.updated_at,jsonb_build_object('occurrences',i.grouped_count+1) summary from incidents i where i.status in('OPEN','ACKNOWLEDGED','INVESTIGATING') order by i.updated_at desc limit 25`,
      ),
      this.pool.query<Row>(
        `select public_id,name,case when enabled then 'ACTIVE' else 'PAUSED' end status,updated_at,jsonb_build_object('prochaine',coalesce(next_run_at::text,'—')) summary from scheduled_tasks order by updated_at desc limit 25`,
      ),
      this.pool.query<Row>(
        `select provider id,provider public_id,provider name,'AVAILABLE' status,max(occurred_at) updated_at,jsonb_build_object('tokens',sum(input_tokens+output_tokens),'coût_microunits',sum(cost_microunits)) summary from model_usage group by provider order by provider`,
      ),
      this.pool.query<Row>(
        `select public_id id,row_number() over(order by occurred_at,id)::int sequence,event_type type,action title,coalesce((result_sanitized->>'status'),'AUDITED') status,to_char(occurred_at,'HH24:MI') occurred_at from audit_logs order by occurred_at desc,id desc limit 20`,
      ),
    ]);
    const missionDtos: MissionDto[] = [];
    for (const row of missions.rows) {
      const timeline = await this.pool.query<Row>(
        `select id::text,sequence::int,event_type type,coalesce(payload_sanitized->>'title',event_type) title,coalesce(payload_sanitized->>'status',event_type) status,to_char(created_at,'HH24:MI') occurred_at from mission_events where mission_id=(select id from missions where public_id=$1::uuid) order by sequence limit 100`,
        [row.public_id],
      );
      missionDtos.push({
        ...entity('missions', row),
        kind: 'missions',
        project: String(row.project),
        machine: String(row.machine),
        model: String(row.model),
        progress: Number(row.progress),
        timeline: timeline.rows.map((item) => ({
          id: String(item.id),
          sequence: Number(item.sequence),
          type: String(item.type),
          title: String(item.title),
          status: String(item.status),
          occurredAt: String(item.occurred_at),
        })),
      });
    }
    const approvalDtos: ApprovalDto[] = approvals.rows.map((row) => ({
      ...entity('approvals', { ...row, name: row.action_key }),
      kind: 'approvals',
      action: String(row.action_key),
      project: String(row.project),
      machine: String(row.machine),
      environment: 'LOCAL',
      model: String(row.model),
      risk: row.level === 'STRONG_APPROVAL' ? 'HIGH' : 'MEDIUM',
      actionHash: String(row.action_hash),
      parameters: row.parameters_sanitized as Record<string, string | number | boolean>,
      expiresAt: new Date(String(row.expires_at)).toISOString(),
    }));
    const health = await this.health();
    return {
      version: 'v1',
      generatedAt: new Date().toISOString(),
      correlationId,
      health,
      missions: missionDtos,
      approvals: approvalDtos,
      incidents: incidents.rows.map((row) => entity('incidents', row)),
      schedules: schedules.rows.map((row) => entity('schedules', row)),
      usage: usage.rows.map((row) => entity('usage', row)),
      activity: activity.rows.map((row) => ({
        id: String(row.id),
        sequence: Number(row.sequence),
        type: String(row.type),
        title: String(row.title),
        status: String(row.status),
        occurredAt: String(row.occurred_at),
      })),
    };
  }

  async diagnostic(correlationId: string): Promise<DiagnosticDto> {
    const components = await this.health();
    return {
      version: 'v1',
      generatedAt: new Date().toISOString(),
      correlationId,
      components,
      degraded: components.some((item) => item.tone === 'ERROR'),
      exportSafe: true,
    };
  }

  async events(after: number, limit: number): Promise<readonly RealtimeEventDto[]> {
    const result = await this.pool.query<Row>(
      `select id::text, id::int sequence,event_type type,action,result_sanitized from audit_logs where id>$1 order by id limit $2`,
      [after, limit],
    );
    return result.rows.map((row) => ({
      version: 'v1',
      id: String(row.id),
      sequence: Number(row.sequence),
      type: String(row.type),
      projection: {
        action: String(row.action),
        status: String((row.result_sanitized as Row | null)?.status ?? 'AUDITED'),
      },
    }));
  }

  async mutate(
    input: MutationRequestDto,
    context: { sessionId: string; correlationId: string },
  ): Promise<MutationResultDto> {
    if (input.action === 'MISSION_CREATE') return this.createMission(input, context.correlationId);
    if (input.action === 'APPROVAL_APPROVE') return this.approve(input, context.correlationId);
    const transitions: Record<
      string,
      { from: readonly string[]; to: string; category: ActionCategory; risk: RiskLevel }
    > = {
      MISSION_PAUSE: {
        from: ['RUNNING', 'PLANNING', 'VERIFYING'],
        to: 'PAUSED',
        category: 'WRITE',
        risk: 'MEDIUM',
      },
      MISSION_RESUME: {
        from: ['PAUSED', 'BLOCKED'],
        to: 'QUEUED',
        category: 'WRITE',
        risk: 'MEDIUM',
      },
      MISSION_CANCEL: {
        from: [
          'CREATED',
          'QUEUED',
          'PLANNING',
          'RUNNING',
          'VERIFYING',
          'WAITING_APPROVAL',
          'PAUSED',
          'BLOCKED',
        ],
        to: 'CANCELLED',
        category: 'WRITE',
        risk: 'HIGH',
      },
    };
    const transition = transitions[input.action];
    if (!transition || !transition.from.includes(input.expectedState))
      return this.result(
        context.correlationId,
        'DENIED',
        input.expectedState,
        'Transition refusée.',
      );
    const target = await this.pool.query<Row>(
      `select m.id,m.public_id,m.status,u.public_id user_id,u.status user_status,coalesce(p.public_id,gen_random_uuid()) project_id,coalesce(p.status,'ACTIVE') project_status,coalesce(mc.public_id,gen_random_uuid()) machine_id,coalesce(mc.status,'ONLINE') machine_status from missions m join users u on u.id=m.user_id left join projects p on p.id=m.project_id left join machines mc on mc.id=m.machine_id where m.public_id=$1::uuid`,
      [input.targetId],
    );
    const row = target.rows[0];
    if (!row || row.status !== input.expectedState)
      return this.result(
        context.correlationId,
        'BLOCKED',
        String(row?.status ?? 'NOT_FOUND'),
        'État modifié, nouvelle évaluation requise.',
      );
    const policyInput: PolicyInput = {
      userId: String(row.user_id),
      userStatus: row.user_status as PolicyInput['userStatus'],
      projectId: String(row.project_id),
      projectStatus: row.project_status as PolicyInput['projectStatus'],
      machineId: String(row.machine_id),
      machineStatus: row.machine_status as PolicyInput['machineStatus'],
      tool: { key: input.action, risk: transition.risk, enabled: true },
      parameters: input.input ?? {},
      environment: 'LOCAL',
      classification: 'LOCAL_ONLY',
      actionCategory: transition.category,
      evaluationHealthy: true,
      connectionAvailable: true,
    };
    const decision = await this.policy.evaluate(policyInput);
    if (decision.decision !== 'ALLOW' && !input.authorizationReference)
      return this.result(
        context.correlationId,
        'WAITING_APPROVAL',
        String(row.status),
        decision.reason,
      );
    const changed = await this.pool.query<Row>(
      `update missions set status=$1,version=version+1,updated_at=now() where public_id=$2::uuid and status=$3 returning status`,
      [transition.to, input.targetId, input.expectedState],
    );
    if (!changed.rowCount)
      return this.result(
        context.correlationId,
        'BLOCKED',
        String(row.status),
        'Modification concurrente.',
      );
    await this.pool.query(
      `select append_audit_log('DASHBOARD',$1,$2::uuid,$3::jsonb,$4::jsonb,$5,null,null,null,$6)`,
      [
        input.action,
        context.correlationId,
        JSON.stringify({ targetId: input.targetId, actionHash: decision.actionHash }),
        JSON.stringify({ status: transition.to }),
        transition.risk,
        row.id,
      ],
    );
    return this.result(context.correlationId, 'COMPLETED', transition.to, 'Action appliquée.');
  }

  private async approve(input: MutationRequestDto, correlationId: string) {
    if (!input.actionHash || !input.authorizationReference)
      return this.result(
        correlationId,
        'DENIED',
        input.expectedState,
        'Empreinte et autorisation requises.',
      );
    const result = await this.pool.query<Row>(
      `with owner as(select id from users where role='OWNER' and status='ACTIVE' order by id limit 1) update approvals set status='APPROVED',decided_by_user_id=owner.id,decided_at=now() from owner where public_id=$1::uuid and status='PENDING' and expires_at>now() and action_hash=$2 returning approvals.status`,
      [input.targetId, input.actionHash],
    );
    if (!result.rowCount)
      return this.result(
        correlationId,
        'BLOCKED',
        'STALE_OR_EXPIRED',
        'Approbation expirée ou modifiée.',
      );
    await this.pool.query(
      `select append_audit_log('APPROVAL','APPROVAL_APPROVE',$1::uuid,$2::jsonb,$3::jsonb,'HIGH',null,null,null,null,null,null,$4::uuid)`,
      [
        correlationId,
        JSON.stringify({ actionHash: input.actionHash }),
        JSON.stringify({ status: 'APPROVED' }),
        input.targetId,
      ],
    );
    return this.result(
      correlationId,
      'COMPLETED',
      'APPROVED',
      'Approbation enregistrée à usage unique.',
    );
  }

  private async createMission(input: MutationRequestDto, correlationId: string) {
    const objective =
      typeof input.input?.objective === 'string' ? input.input.objective.trim() : '';
    const model = typeof input.input?.model === 'string' ? input.input.model.trim() : '';
    const project = typeof input.input?.project === 'string' ? input.input.project.trim() : '';
    const machine = typeof input.input?.machine === 'string' ? input.input.machine.trim() : '';
    if (!objective || objective.length > 4_000 || !model || model.length > 200) {
      return this.result(correlationId, 'DENIED', 'INVALID', 'Objectif ou modèle invalide.');
    }
    const created = await this.pool.query<Row>(
      `with owner as(select id from users where role='OWNER' and status='ACTIVE' order by id limit 1), project as(select id,primary_machine_id from projects where status='ACTIVE' and ($4='' or public_id::text=$4 or name=$4) order by id limit 1), machine as(select id from machines where status in('ONLINE','BUSY') and ($5='' or public_id::text=$5 or name=$5) order by id limit 1) insert into missions(user_id,project_id,machine_id,prompt_initial,normalized_goal,status,requested_provider,requested_model,context) select owner.id,project.id,coalesce(machine.id,project.primary_machine_id),$1,$2,'QUEUED',nullif(split_part($3,':',1),''),$3,jsonb_build_object('title',left($2,120),'source',$6::text) from owner cross join project left join machine on true returning id,public_id,status`,
      [
        objective,
        objective.replace(/\s+/gu, ' '),
        model,
        project,
        machine,
        typeof input.input?.source === 'string' ? input.input.source : 'DASHBOARD',
      ],
    );
    const row = created.rows[0];
    if (!row)
      return this.result(
        correlationId,
        'BLOCKED',
        'NO_ACTIVE_PROJECT',
        'Configurez un projet actif.',
      );
    await this.pool.query(
      `select append_audit_log('MISSION','MISSION_CREATE',$1::uuid,$2::jsonb,$3::jsonb,'LOW',null,null,null,$4)`,
      [
        correlationId,
        JSON.stringify({ source: 'DASHBOARD', model }),
        JSON.stringify({ status: row.status, missionId: row.public_id }),
        row.id,
      ],
    );
    return this.result(
      correlationId,
      'COMPLETED',
      String(row.status),
      `Mission ${String(row.public_id)} créée.`,
    );
  }

  private result(
    correlationId: string,
    status: MutationResultDto['status'],
    state: string,
    message: string,
  ): MutationResultDto {
    return { version: 'v1', correlationId, status, state, message };
  }

  private async health(): Promise<readonly EntityDto[]> {
    const started = performance.now();
    await this.pool.query('select 1');
    const now = new Date().toISOString();
    return [
      {
        id: 'api',
        kind: 'agents',
        name: 'API',
        status: 'READY',
        tone: 'OK',
        summary: { version: '0.1.0-rc.1' },
        updatedAt: now,
      },
      {
        id: 'postgres',
        kind: 'agents',
        name: 'PostgreSQL',
        status: 'AVAILABLE',
        tone: 'OK',
        summary: { latenceMs: Math.round(performance.now() - started) },
        updatedAt: now,
      },
    ];
  }
}

export function safeProjectLabel(path: string) {
  return basename(path);
}
