import type { SqlClient } from './sql.js';

export interface ModelRunAuditEvent {
  readonly correlationId: string;
  readonly missionId: string;
  readonly agentKey: string;
  readonly provider: string;
  readonly requestedModel: string;
  readonly returnedModel?: string;
  readonly classification: 'PUBLIC' | 'CLOUD_SAFE' | 'LOCAL_ONLY' | 'SECRET';
  readonly status: 'COMPLETED' | 'FAILED' | 'BLOCKED';
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostMicrounits: number;
  readonly reason: string;
}

export class SqlModelRunAuditSink {
  constructor(private readonly sql: SqlClient) {}

  async record(event: ModelRunAuditEvent): Promise<void> {
    await this.sql.query(
      `with resolved as (
         select m.id as mission_id, m.user_id, a.id as agent_id
         from missions m join agents a on a.agent_key = $2
         where m.public_id = $1::uuid
       ), inserted as (
         insert into agent_runs (
           mission_id, agent_id, provider, model, requested_model, returned_model,
           input_classification, status, input_tokens, output_tokens, cost_microunits,
           started_at, completed_at, latency_ms, failure_reason
         )
         select mission_id, agent_id, $3, coalesce($5, $4), $4, $5, $6,
                case when $7 = 'COMPLETED' then 'COMPLETED' else 'FAILED' end,
                $9, $10, $11, now() - make_interval(secs => $8::double precision / 1000),
                now(), $8, case when $7 = 'COMPLETED' then null else $12 end
         from resolved
         returning id, mission_id
       ), usage as (
         insert into model_usage (
           user_id, mission_id, agent_run_id, provider, model,
           input_tokens, output_tokens, cost_microunits
         )
         select r.user_id, i.mission_id, i.id, $3, coalesce($5, $4), $9, $10, $11
         from inserted i join resolved r on r.mission_id = i.mission_id
       )
       select append_audit_log(
         'MODEL_RUN', 'model_generate', $13::uuid,
         jsonb_build_object('provider', $3::text, 'requested_model', $4::text,
                            'returned_model', $5::text, 'classification', $6::text),
         jsonb_build_object('status', $7::text, 'input_tokens', $9::bigint,
                            'output_tokens', $10::bigint, 'cost_microunits', $11::bigint,
                            'reason', $12::text),
         null, null, null, null, (select mission_id from inserted),
         (select id from inserted), null, null, $8::bigint
       )`,
      [
        event.missionId,
        event.agentKey,
        event.provider,
        event.requestedModel,
        event.returnedModel ?? null,
        event.classification,
        event.status,
        event.latencyMs,
        event.inputTokens,
        event.outputTokens,
        event.estimatedCostMicrounits,
        event.reason,
        event.correlationId,
      ],
    );
  }
}
