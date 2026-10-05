import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PostgresDashboardApplication } from '@arcc/api';
import { KnowledgeStoreRepository } from '@arcc/database';
import { LocalDerivedKnowledgeArtifactStore } from '@arcc/knowledge';
import { nextOccurrence, validateSchedule, type ScheduleDefinition } from '@arcc/scheduler';
import type { Pool } from 'pg';
import type { TelegramOperationPort } from './experience.js';

export interface TelegramStrongApprovalPort {
  authorize(actionId: string, pin: string): Promise<void>;
}

function lines(title: string, items: readonly { id: string; name: string; status: string }[]) {
  return items.length
    ? `${title}\n${items.map((item) => `- ${item.name} [${item.status}] (${item.id})`).join('\n')}`
    : `${title}\nAucun element.`;
}

function reply(
  text: string,
  extra: Readonly<{
    targetReference?: string;
    stateReference?: string;
    actions?: readonly (
      'TAKEOVER' | 'CONTINUE' | 'RETRY' | 'PURGE_MEMORY' | 'INVESTIGATE' | 'RESTART' | 'IGNORE'
    )[];
  }> = {},
) {
  return {
    text,
    classification: 'LOCAL_ONLY' as const,
    telegramAuthorized: true,
    ...extra,
  };
}

function stateTag(value: unknown): string {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

function exactReference(value: string): string {
  return value.trim().split(/\s+/u)[0] ?? '';
}

function parsePin(value: string | undefined): { body: string; pin?: string } {
  const parts = value?.trim().split(/\s+/u).filter(Boolean) ?? [];
  const candidate = parts.at(-1);
  return /^\d{6}$/u.test(candidate ?? '')
    ? { body: parts.slice(0, -1).join(' '), pin: candidate as string }
    : { body: parts.join(' ') };
}

export class PostgresTelegramOperations implements TelegramOperationPort {
  private readonly application: PostgresDashboardApplication;
  constructor(
    private readonly pool: Pool,
    private readonly strongApproval?: TelegramStrongApprovalPort,
    private readonly dataRoot?: string,
  ) {
    this.application = new PostgresDashboardApplication(pool);
  }

  async validateSelection(input: { kind: 'PROJECT' | 'MACHINE' | 'MODEL'; value: string }) {
    const specifications = {
      PROJECT: [
        `select 1 from projects where status='ACTIVE' and (public_id::text=$1 or name=$1)`,
        input.value,
      ],
      MACHINE: [
        `select 1 from machines where status in('ONLINE','BUSY') and (public_id::text=$1 or name=$1)`,
        input.value,
      ],
      MODEL: [
        `select 1 from model_catalog where enabled and available and provider||':'||model=$1`,
        input.value,
      ],
    } as const;
    const [sql, value] = specifications[input.kind];
    return Boolean((await this.pool.query(sql, [value])).rowCount);
  }

  async invoke(input: Parameters<TelegramOperationPort['invoke']>[0]) {
    const correlationId = randomUUID();
    if (input.command === 'approve') {
      const [reference = '', pin = ''] = input.argument?.trim().split(/\s+/u) ?? [];
      if (!reference || !/^\d{6}$/u.test(pin)) {
        return {
          text: 'Usage : /approve <identifiant> <PIN a 6 chiffres>.',
          classification: 'LOCAL_ONLY' as const,
          telegramAuthorized: true,
        };
      }
      const selected = await this.pool.query<{
        public_id: string;
        action_hash: string;
        level: 'APPROVAL' | 'STRONG_APPROVAL';
      }>(
        `select public_id::text,action_hash,level from approvals
         where status='PENDING' and expires_at>now()
           and (public_id::text=$1 or public_id::text like $1||'%')
         order by created_at limit 1`,
        [reference],
      );
      const approval = selected.rows[0];
      if (!approval) {
        return {
          text: 'Approbation introuvable ou expiree.',
          classification: 'LOCAL_ONLY' as const,
          telegramAuthorized: true,
        };
      }
      if (approval.level === 'STRONG_APPROVAL') {
        if (!this.strongApproval) throw new Error('telegram_pin_gate_unavailable');
        await this.strongApproval.authorize(approval.public_id, pin);
      }
      const result = await this.application.mutate(
        {
          action: 'APPROVAL_APPROVE',
          targetId: approval.public_id,
          expectedState: 'PENDING',
          actionHash: approval.action_hash,
          authorizationReference: `telegram:${approval.public_id}`,
        },
        { sessionId: 'telegram-owner', correlationId },
      );
      return {
        text: result.message,
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
      };
    }
    if (input.command === 'task') {
      const model = input.model ? `${input.model.provider}:${input.model.model}` : '';
      const result = await this.application.mutate(
        {
          action: 'MISSION_CREATE',
          targetId: 'new',
          expectedState: 'NEW',
          input: {
            objective: input.objective ?? '',
            model,
            project: input.project ?? '',
            machine: input.machine ?? '',
            source: 'TELEGRAM',
          },
        },
        { sessionId: 'telegram-owner', correlationId },
      );
      const missionId = result.message.match(/[0-9a-f]{8}-[0-9a-f-]{27}/iu)?.[0];
      return {
        text: result.message,
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
        ...(input.model ? { usedModel: input.model } : {}),
        ...(missionId
          ? { targetReference: missionId.slice(0, 16), stateReference: result.state.slice(0, 8) }
          : {}),
      };
    }
    const administration = await this.administrative(input.command, input.argument, correlationId);
    if (administration) return administration;
    const listKinds = {
      projects: 'projects',
      machines: 'machines',
      models: 'models',
      approvals: 'approvals',
      tasks: 'missions',
      schedules: 'schedules',
    } as const;
    const kind = listKinds[input.command as keyof typeof listKinds];
    if (kind) {
      const page = await this.application.list(
        kind,
        { limit: 20, sort: 'updatedAt' },
        correlationId,
      );
      return {
        text: lines(`ARCC - ${input.command}`, page.items),
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
      };
    }
    if (input.command === 'status') {
      const overview = await this.application.overview(correlationId);
      return {
        text: `ARCC operationnel. Missions actives: ${overview.missions.length}. Approbations: ${overview.approvals.length}. Incidents: ${overview.incidents.length}.`,
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
      };
    }
    if (input.command === 'queue') {
      const queued = await this.pool.query<{ public_id: string; status: string }>(
        `select public_id::text,status from missions
         where status in('QUEUED','PLANNING','RUNNING','VERIFYING','WAITING_APPROVAL','PAUSED','BLOCKED')
         order by submission_sequence limit 20`,
      );
      return {
        text: queued.rows.length
          ? `File des missions\n${queued.rows.map((row) => `- ${row.public_id.slice(0, 16)} [${row.status}]`).join('\n')}`
          : 'File des missions vide.',
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
      };
    }
    if (input.command === 'plan') {
      const reference = input.argument?.trim().split(/\s+/u)[0] ?? '';
      const steps = await this.pool.query<{ logical_id: string; status: string }>(
        `select coalesce(s.tool_key,s.public_id::text) logical_id,s.status
         from mission_steps s join missions m on m.id=s.mission_id
         where m.public_id::text=$1 or m.public_id::text like $1||'%'
         order by s.position limit 50`,
        [reference],
      );
      const session = await this.pool.query<{
        public_id: string;
        status: string;
        control_mode: string;
        updated_at: string;
      }>(
        `select s.public_id::text,s.status,s.control_mode,s.updated_at::text
         from computer_use_sessions s join missions m on m.id=s.mission_id
         where m.public_id::text=$1 or m.public_id::text like $1||'%' limit 1`,
        [reference],
      );
      const active = session.rows[0];
      return {
        text: steps.rows.length
          ? `Plan de mission (etats uniquement)\n${steps.rows.map((row) => `- ${row.logical_id.slice(0, 64)} [${row.status}]`).join('\n')}`
          : 'Plan introuvable. Utilisez /plan <mission>.',
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
        ...(active
          ? {
              targetReference: active.public_id.slice(0, 16),
              stateReference: stateTag(
                `${active.status}:${active.control_mode}:${active.updated_at}`,
              ),
              actions: [
                active.control_mode === 'TAKEOVER' ? ('CONTINUE' as const) : ('TAKEOVER' as const),
              ],
            }
          : {}),
      };
    }
    if (input.command === 'files' || input.command === 'proof') {
      const reference = input.argument?.trim().split(/\s+/u)[0] ?? '';
      const result =
        input.command === 'files'
          ? await this.pool.query<{
              public_id: string;
              size_bytes: string;
              classification: string;
            }>(
              `select f.public_id::text,f.size_bytes,f.classification
               from files f left join missions m on m.id=f.mission_id left join projects p on p.id=f.project_id
               where f.classification<>'SECRET' and ($1='' or m.public_id::text=$1
                 or m.public_id::text like $1||'%' or p.public_id::text=$1
                 or p.public_id::text like $1||'%')
               order by f.created_at desc limit 20`,
              [reference],
            )
          : await this.pool.query<{
              public_id: string;
              size_bytes: string;
              classification: string;
            }>(
              `select a.public_id::text,0::text size_bytes,'LOCAL_ONLY' classification
               from artifacts a join missions m on m.id=a.mission_id
               where $1='' or m.public_id::text=$1 or m.public_id::text like $1||'%'
               order by a.created_at desc limit 20`,
              [reference],
            );
      return {
        text: result.rows.length
          ? `${input.command === 'files' ? 'Fichiers' : 'Preuves'} (identifiants uniquement)\n${result.rows.map((row) => `- ${row.public_id.slice(0, 16)} [${row.classification}] ${row.size_bytes} octets`).join('\n')}`
          : `Aucun ${input.command === 'files' ? 'fichier' : 'element de preuve'}.`,
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
      };
    }
    if (input.command === 'logs') {
      const reference = input.argument?.trim().split(/\s+/u)[0] ?? '';
      const events = await this.pool.query<{ type: string; at: string }>(
        reference
          ? `select e.event_type type,to_char(e.created_at,'YYYY-MM-DD HH24:MI:SS') at
             from mission_events e join missions m on m.id=e.mission_id
             where m.public_id::text=$1 or m.public_id::text like $1||'%'
             order by e.created_at desc,e.id desc limit 30`
          : `select event_type type,to_char(occurred_at,'YYYY-MM-DD HH24:MI:SS') at
             from audit_logs order by occurred_at desc,id desc limit 30`,
        reference ? [reference] : [],
      );
      return {
        text: events.rows.length
          ? `Journal (types et horaires uniquement)\n${events.rows.map((row) => `- ${row.at} ${row.type.slice(0, 80)}`).join('\n')}`
          : 'Aucun evenement disponible.',
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
      };
    }
    if (input.command === 'monitors') {
      const monitors = await this.pool.query<{
        public_id: string;
        monitor_type: string;
        enabled: boolean;
      }>(
        `select public_id::text,monitor_type,enabled
         from monitor_definitions order by updated_at desc limit 20`,
      );
      return {
        text: monitors.rows.length
          ? `Moniteurs\n${monitors.rows.map((row) => `- ${row.public_id.slice(0, 16)} [${row.monitor_type}/${row.enabled ? 'ACTIF' : 'INACTIF'}]`).join('\n')}`
          : 'Aucun moniteur configure.',
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
      };
    }
    if (input.command === 'scheduler') {
      const state = await this.pool.query<{
        paused: boolean;
        autonomy: string;
        pending: string;
        running: string;
        unknown: string;
      }>(
        `select globally_paused paused,autonomy_level autonomy,
           (select count(*) from schedule_occurrences where status='PENDING') pending,
           (select count(*) from schedule_occurrences where status='RUNNING') running,
           (select count(*) from schedule_occurrences where status='UNKNOWN') unknown
         from scheduler_control where singleton=true`,
      );
      const row = state.rows[0];
      return {
        text: row
          ? `Scheduler ${row.paused ? 'EN PAUSE' : 'ACTIF'} - autonomie ${row.autonomy}, attente ${row.pending}, execution ${row.running}, inconnues ${row.unknown}.`
          : 'Scheduler indisponible.',
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
      };
    }
    if (input.command === 'memory') {
      const values = await this.pool.query<{ scope: string; count: string }>(
        `select scope,count(*)::text count from memories where invalidated_at is null
         group by scope order by scope`,
      );
      return {
        text: values.rows.length
          ? `Memoire locale (compteurs uniquement)\n${values.rows.map((row) => `- ${row.scope}: ${row.count}`).join('\n')}`
          : 'Memoire locale vide.',
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
      };
    }
    if (['pause', 'resume', 'stop'].includes(input.command)) {
      const reference = input.argument?.trim().split(/\s+/u)[0] ?? '';
      const target = await this.pool.query<{ public_id: string; status: string }>(
        `select public_id::text,status from missions where public_id::text=$1 or public_id::text like $1||'%' order by updated_at desc limit 1`,
        [reference],
      );
      const mission = target.rows[0];
      if (!mission)
        return {
          text: 'Mission introuvable.',
          classification: 'LOCAL_ONLY' as const,
          telegramAuthorized: true,
        };
      const action =
        input.command === 'pause'
          ? 'MISSION_PAUSE'
          : input.command === 'resume'
            ? 'MISSION_RESUME'
            : 'MISSION_CANCEL';
      const result = await this.application.mutate(
        { action, targetId: mission.public_id, expectedState: mission.status },
        { sessionId: 'telegram-owner', correlationId },
      );
      return {
        text: result.message,
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
      };
    }
    return {
      text: `Commande /${input.command} reconnue, mais aucune action sure n'est disponible dans cet etat.`,
      classification: 'LOCAL_ONLY' as const,
      telegramAuthorized: true,
    };
  }

  private async administrative(
    command: string,
    argument: string | undefined,
    correlationId: string,
  ): Promise<ReturnType<typeof reply> | undefined> {
    if (command === 'reject') return this.rejectApproval(argument, correlationId);
    if (command === 'retry') return this.retryMission(argument, correlationId);
    if (command === 'takeover' || command === 'continue') {
      return this.controlComputerUse(command, argument, correlationId);
    }
    if (command === 'screen') return this.screenMetadata(argument);
    if (command === 'dryrun') return this.dryRun(argument);
    if (command === 'schedule') return this.createSchedule(argument, correlationId);
    if (
      ['schedule_pause', 'schedule_resume', 'schedule_run', 'schedule_delete'].includes(command)
    ) {
      return this.manageSchedule(command, argument, correlationId);
    }
    if (command === 'autonomy') return this.manageAutonomy(argument, correlationId);
    if (command === 'scheduler' && argument?.trim()) {
      return this.manageScheduler(argument, correlationId);
    }
    if (command === 'incidents') return this.listIncidents();
    if (command === 'incident') return this.manageIncident(argument, correlationId);
    if (command === 'forget') return this.forgetProject(argument, correlationId);
    return undefined;
  }

  private async rejectApproval(argument: string | undefined, correlationId: string) {
    const reference = exactReference(argument ?? '');
    if (!reference) return reply('Usage : /reject <identifiant>.');
    const selected = await this.pool.query<{ public_id: string }>(
      `select public_id::text from approvals where status='PENDING' and expires_at>now()
       and (public_id::text=$1 or public_id::text like $1||'%') order by created_at limit 2`,
      [reference],
    );
    if (selected.rows.length !== 1) return reply('Approbation introuvable ou ambigue.');
    const result = await this.pool.query<{ public_id: string }>(
      `with owner as(select id from users where role='OWNER' and status='ACTIVE' order by id limit 1)
       update approvals a set status='REJECTED',decided_by_user_id=owner.id,decided_at=now()
       from owner where a.public_id=$1::uuid and a.status='PENDING' and a.expires_at>now()
       returning a.public_id::text`,
      [selected.rows[0]!.public_id],
    );
    const approval = result.rows[0];
    if (!approval || result.rowCount !== 1) return reply('Approbation introuvable ou ambigue.');
    await this.audit('APPROVAL_REJECT', correlationId, { approvalId: approval.public_id }, 'LOW');
    return reply(`Approbation ${approval.public_id.slice(0, 16)} rejetee.`);
  }

  private async retryMission(argument: string | undefined, correlationId: string) {
    const raw = argument?.trim() ?? '';
    const callback = /^RETRY:([^:]+):([a-f0-9]{8})$/u.exec(raw);
    const reference = callback?.[1] ?? exactReference(raw);
    if (!reference) return reply('Usage : /retry <mission>.');
    const selected = await this.pool.query<{
      public_id: string;
      status: string;
      version: number;
    }>(
      `select public_id::text,status,version from missions
       where public_id::text=$1 or public_id::text like $1||'%' order by updated_at desc limit 2`,
      [reference],
    );
    if (selected.rows.length !== 1) return reply('Mission introuvable ou ambigue.');
    const mission = selected.rows[0]!;
    const state = stateTag(`${mission.status}:${mission.version}`);
    if (!callback) {
      if (!['BLOCKED', 'FAILED'].includes(mission.status))
        return reply(`La mission est ${mission.status}; aucune reprise n'est applicable.`);
      return reply('Confirmer la reprise de cette mission.', {
        targetReference: mission.public_id.slice(0, 16),
        stateReference: state,
        actions: ['RETRY'],
      });
    }
    if (callback[2] !== state) return reply('Etat de mission modifie; rechargez la commande.');
    const changed = await this.pool.query(
      `update missions set status='QUEUED',blocked_reason=null,blocked_action=null,
       cancellation_requested=false,lease_owner=null,lease_expires_at=null,version=version+1,
       updated_at=now() where public_id=$1::uuid and status in('BLOCKED','FAILED') and version=$2`,
      [mission.public_id, mission.version],
    );
    if (changed.rowCount !== 1) return reply('Reprise bloquee par une modification concurrente.');
    await this.audit('MISSION_RETRY', correlationId, { missionId: mission.public_id }, 'MEDIUM');
    return reply('Mission replacee dans la file avec reevaluation complete.');
  }

  private async controlComputerUse(
    command: 'takeover' | 'continue',
    argument: string | undefined,
    correlationId: string,
  ) {
    const action = command === 'takeover' ? 'TAKEOVER' : 'CONTINUE';
    const raw = argument?.trim() ?? '';
    const callback = new RegExp(`^${action}:([^:]+):([a-f0-9]{8})$`, 'u').exec(raw);
    const reference = callback?.[1] ?? exactReference(raw);
    if (!reference) return reply(`Usage : /${command} <mission ou session>.`);
    const selected = await this.pool.query<{
      public_id: string;
      mission_id: string;
      status: string;
      control_mode: string;
      updated_at: string;
    }>(
      `select s.public_id::text,m.public_id::text mission_id,s.status,s.control_mode,s.updated_at::text
       from computer_use_sessions s join missions m on m.id=s.mission_id
       where s.public_id::text=$1 or s.public_id::text like $1||'%'
          or m.public_id::text=$1 or m.public_id::text like $1||'%'
       order by s.updated_at desc limit 2`,
      [reference],
    );
    if (selected.rows.length !== 1) return reply('Session Computer Use introuvable ou ambigue.');
    const session = selected.rows[0]!;
    const state = stateTag(`${session.status}:${session.control_mode}:${session.updated_at}`);
    if (!callback) {
      return reply(
        command === 'takeover'
          ? 'Confirmer le passage en controle humain.'
          : 'Confirmer la reprise de l’automatisation; le contexte sera reverifie.',
        {
          targetReference: session.public_id.slice(0, 16),
          stateReference: state,
          actions: [action],
        },
      );
    }
    if (callback[2] !== state) return reply('Contexte Computer Use modifie; recommencez.');
    const targetMode = command === 'takeover' ? 'TAKEOVER' : 'AUTOMATION';
    const targetStatus = command === 'takeover' ? 'TAKEOVER' : 'WAITING_FOR_UI';
    const changed = await this.pool.query(
      `update computer_use_sessions set control_mode=$2,status=$3,lease_owner=null,
       lease_until=null,updated_at=now() where public_id=$1::uuid and emergency_stop=false
       and status=$4 and control_mode=$5`,
      [session.public_id, targetMode, targetStatus, session.status, session.control_mode],
    );
    if (changed.rowCount !== 1) return reply('Transition refusee ou contexte modifie.');
    await this.audit(
      `COMPUTER_USE_${action}`,
      correlationId,
      { sessionId: session.public_id },
      'MEDIUM',
    );
    return reply(
      command === 'takeover' ? 'Controle humain actif.' : 'Reprise demandee avec revalidation.',
    );
  }

  private async screenMetadata(argument: string | undefined) {
    const reference = exactReference(argument ?? '');
    if (!reference) return reply('Usage : /screen <mission>.');
    const result = await this.pool.query<{
      public_id: string;
      status: string;
      proof_count: string;
    }>(
      `select s.public_id::text,s.status,
       (select count(*)::text from computer_use_actions a where a.session_id=s.id
          and (a.before_proof is not null or a.after_proof is not null)) proof_count
       from computer_use_sessions s join missions m on m.id=s.mission_id
       where m.public_id::text=$1 or m.public_id::text like $1||'%' limit 1`,
      [reference],
    );
    const row = result.rows[0];
    return row
      ? reply(
          `Session ${row.public_id.slice(0, 16)} [${row.status}], preuves visuelles: ${row.proof_count}. L'image brute n'est jamais envoyee sur Telegram.`,
        )
      : reply('Aucune session visuelle pour cette mission.');
  }

  private async dryRun(argument: string | undefined) {
    const reference = exactReference(argument ?? '');
    if (!reference) return reply('Usage : /dryrun <mission>.');
    const result = await this.pool.query<{ public_id: string; status: string; steps: string }>(
      `select m.public_id::text,m.status,
       (select count(*)::text from mission_steps s where s.mission_id=m.id) steps
       from missions m where m.public_id::text=$1 or m.public_id::text like $1||'%' limit 1`,
      [reference],
    );
    const row = result.rows[0];
    return row
      ? reply(
          `Simulation ${row.public_id.slice(0, 16)} : ${row.steps} etapes, etat ${row.status}; aucune action n'a ete executee.`,
        )
      : reply('Mission introuvable.');
  }

  private async createSchedule(argument: string | undefined, correlationId: string) {
    if (!argument?.trim()) {
      return reply(
        'Usage : /schedule {"name":"...","project":"...","triggerType":"INTERVAL","expression":"PT1H","objective":"..."}. La planification est creee en pause.',
      );
    }
    let input: Record<string, unknown>;
    try {
      const value = JSON.parse(argument) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      input = value as Record<string, unknown>;
    } catch {
      return reply('Definition JSON de planification invalide.');
    }
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const project = typeof input.project === 'string' ? input.project.trim() : '';
    const triggerType = String(input.triggerType ?? '');
    const expression = typeof input.expression === 'string' ? input.expression.trim() : '';
    const objective = typeof input.objective === 'string' ? input.objective.trim() : '';
    const timezone = typeof input.timezone === 'string' ? input.timezone.trim() : 'Africa/Douala';
    const catchUpPolicy = String(input.catchUpPolicy ?? 'LATEST_ONLY');
    const catchUpLimit = Number(input.catchUpLimit ?? 1);
    if (
      !name ||
      name.length > 120 ||
      !project ||
      !objective ||
      objective.length > 4_000 ||
      !['ONE_SHOT', 'INTERVAL', 'CRON', 'LOCAL_EVENT'].includes(triggerType) ||
      !['SKIP', 'LATEST_ONLY', 'BOUNDED'].includes(catchUpPolicy)
    )
      return reply('Nom, projet, declencheur ou objectif invalide.');
    const definition: ScheduleDefinition = {
      id: 'telegram-preview',
      triggerType: triggerType as ScheduleDefinition['triggerType'],
      expression,
      timezone,
      catchUpPolicy: catchUpPolicy as ScheduleDefinition['catchUpPolicy'],
      catchUpLimit,
    };
    let nextRunAt: string | null;
    try {
      validateSchedule(definition);
      nextRunAt = nextOccurrence(definition, new Date())?.toISOString() ?? null;
      if (triggerType === 'ONE_SHOT' && !nextRunAt) throw new Error('one_shot_must_be_future');
    } catch (error) {
      return reply(
        `Planification refusee : ${error instanceof Error ? error.message : 'definition invalide'}.`,
      );
    }
    const classification = ['PUBLIC', 'CLOUD_SAFE', 'LOCAL_ONLY'].includes(
      String(input.classification),
    )
      ? String(input.classification)
      : 'LOCAL_ONLY';
    const risk = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(input.risk))
      ? String(input.risk)
      : 'LOW';
    try {
      const created = await this.pool.query<{ public_id: string }>(
        `with owner as(select id from users where role='OWNER' and status='ACTIVE' order by id limit 1),
         project as(select id from projects where status='ACTIVE' and (public_id::text=$2 or name=$2) order by id limit 1)
         insert into scheduled_tasks(user_id,project_id,name,trigger_type,schedule_expression,
           mission_template,enabled,next_run_at,timezone,catch_up_policy,catch_up_limit,
           autonomy_level,status,event_key)
         select owner.id,project.id,$1,$3,$4,$5::jsonb,false,$6::timestamptz,$7,$8,$9,
           'EXECUTE_SAFE','PAUSED',case when $3='LOCAL_EVENT' then $4 else null end
         from owner cross join project returning public_id::text`,
        [
          name,
          project,
          triggerType,
          expression,
          JSON.stringify({
            objective,
            classification,
            risk,
            ...(typeof input.model === 'string' ? { model: input.model.slice(0, 200) } : {}),
            successCriteria: ['Objectif planifie traite'],
            definitionOfDone: ['Rapport final disponible'],
          }),
          nextRunAt,
          timezone,
          catchUpPolicy,
          catchUpLimit,
        ],
      );
      const schedule = created.rows[0];
      if (!schedule) return reply('Projet actif introuvable.');
      await this.audit(
        'SCHEDULE_CREATE',
        correlationId,
        { scheduleId: schedule.public_id },
        'MEDIUM',
      );
      return reply(
        `Planification ${schedule.public_id.slice(0, 16)} creee en pause. Utilisez /schedule_resume <id> <PIN>.`,
      );
    } catch (error) {
      return reply(
        `Creation refusee : ${error instanceof Error && error.message.includes('unique') ? 'nom deja utilise' : 'definition non applicable'}.`,
      );
    }
  }

  private async manageSchedule(
    command: string,
    argument: string | undefined,
    correlationId: string,
  ) {
    const { body, pin } = parsePin(argument);
    const reference = exactReference(body);
    if (!reference)
      return reply(
        `Usage : /${command} <planification>${command === 'schedule_pause' ? '' : ' <PIN>'}.`,
      );
    const selected = await this.pool.query<{
      public_id: string;
      status: string;
      enabled: boolean;
      blocked_reason: string | null;
      updated_at: string;
    }>(
      `select public_id::text,status,enabled,blocked_reason,updated_at::text from scheduled_tasks
       where public_id::text=$1 or public_id::text like $1||'%' order by updated_at desc limit 2`,
      [reference],
    );
    if (selected.rows.length !== 1) return reply('Planification introuvable ou ambigue.');
    const schedule = selected.rows[0]!;
    if (schedule.blocked_reason === 'deleted_by_owner' && command !== 'schedule_delete')
      return reply('Cette planification est archivee et ne peut pas etre reactivee.');
    const sensitive = command !== 'schedule_pause';
    if (sensitive) {
      if (!pin)
        return reply(
          `Un PIN a 6 chiffres est requis : /${command} ${schedule.public_id.slice(0, 16)} <PIN>.`,
        );
      if (!this.strongApproval) throw new Error('telegram_pin_gate_unavailable');
      await this.strongApproval.authorize(
        `${command}:${schedule.public_id}:${stateTag(`${schedule.status}:${schedule.enabled}:${schedule.updated_at}`)}`,
        pin,
      );
    }
    if (command === 'schedule_run') {
      const inserted = await this.pool.query(
        `insert into schedule_occurrences(schedule_id,project_id,occurrence_key,due_at,idempotency_key,max_attempts)
         select id,project_id,$2,now(),'schedule:'||public_id||':'||$2,max_attempts
         from scheduled_tasks where public_id=$1::uuid and status<>'BLOCKED'`,
        [schedule.public_id, `manual:${correlationId}`],
      );
      if (inserted.rowCount !== 1)
        return reply('Execution manuelle refusee pour cette planification.');
    } else {
      const values =
        command === 'schedule_pause'
          ? [false, 'PAUSED', null]
          : command === 'schedule_resume'
            ? [true, 'ACTIVE', null]
            : [false, 'BLOCKED', 'deleted_by_owner'];
      const changed = await this.pool.query(
        `update scheduled_tasks set enabled=$2,status=$3,blocked_reason=$4,updated_at=now()
         where public_id=$1::uuid and status<>'COMPLETED'`,
        [schedule.public_id, ...values],
      );
      if (changed.rowCount !== 1) return reply('Planification modifiee ou terminee.');
    }
    await this.audit(
      command.toUpperCase(),
      correlationId,
      { scheduleId: schedule.public_id },
      sensitive ? 'HIGH' : 'LOW',
    );
    const messages: Record<string, string> = {
      schedule_pause: 'Planification mise en pause.',
      schedule_resume: 'Planification reactivee.',
      schedule_run: 'Occurrence manuelle ajoutee de facon idempotente.',
      schedule_delete: 'Planification desactivee et archivee sans supprimer son historique.',
    };
    return reply(messages[command] ?? 'Planification mise a jour.');
  }

  private async manageAutonomy(argument: string | undefined, correlationId: string) {
    const { body, pin } = parsePin(argument);
    const requested = body.trim().toUpperCase();
    const current = await this.pool.query<{ autonomy: string; generation: string }>(
      `select autonomy_level autonomy,pause_generation::text generation from scheduler_control where singleton=true`,
    );
    const row = current.rows[0];
    if (!row) return reply('Controle du scheduler indisponible.');
    if (!requested) return reply(`Autonomie actuelle : ${row.autonomy}.`);
    if (!['OBSERVE', 'ASSIST', 'EXECUTE_SAFE', 'AUTONOMOUS'].includes(requested))
      return reply('Niveau attendu : OBSERVE, ASSIST, EXECUTE_SAFE ou AUTONOMOUS.');
    if (requested === 'AUTONOMOUS') {
      if (!pin) return reply('Le niveau AUTONOMOUS exige : /autonomy AUTONOMOUS <PIN>.');
      if (!this.strongApproval) throw new Error('telegram_pin_gate_unavailable');
      await this.strongApproval.authorize(`autonomy:${requested}:${row.generation}`, pin);
    }
    await this.pool.query(
      `update scheduler_control set autonomy_level=$1,updated_at=now() where singleton=true`,
      [requested],
    );
    await this.audit(
      'SCHEDULER_AUTONOMY_CHANGED',
      correlationId,
      { from: row.autonomy, to: requested },
      requested === 'AUTONOMOUS' ? 'HIGH' : 'LOW',
    );
    return reply(`Autonomie scheduler : ${requested}.`);
  }

  private async manageScheduler(argument: string, correlationId: string) {
    const { body, pin } = parsePin(argument);
    const action = body.trim().toUpperCase();
    if (!['PAUSE', 'RESUME'].includes(action))
      return reply('Usage : /scheduler pause ou /scheduler resume <PIN>.');
    if (action === 'RESUME') {
      if (!pin) return reply('La reprise globale exige : /scheduler resume <PIN>.');
      if (!this.strongApproval) throw new Error('telegram_pin_gate_unavailable');
      const current = await this.pool.query<{ generation: string }>(
        `select pause_generation::text generation from scheduler_control where singleton=true`,
      );
      await this.strongApproval.authorize(
        `scheduler:resume:${current.rows[0]?.generation ?? 'missing'}`,
        pin,
      );
    }
    const changed = await this.pool.query<{ generation: string }>(
      `update scheduler_control set globally_paused=$1,pause_generation=pause_generation+1,
       updated_at=now() where singleton=true returning pause_generation::text generation`,
      [action === 'PAUSE'],
    );
    await this.audit(
      `SCHEDULER_GLOBAL_${action}D`,
      correlationId,
      { generation: changed.rows[0]?.generation },
      action === 'PAUSE' ? 'LOW' : 'HIGH',
    );
    return reply(
      action === 'PAUSE' ? 'Scheduler global mis en pause.' : 'Scheduler global relance.',
    );
  }

  private async listIncidents() {
    const result = await this.pool.query<{
      public_id: string;
      status: string;
      severity: string;
      restart_count: number;
      updated_at: string;
    }>(
      `select public_id::text,status,severity,restart_count,updated_at::text from incidents
       where status in('OPEN','ACKNOWLEDGED','INVESTIGATING')
       order by case severity when 'SECURITY' then 1 when 'ERROR' then 2 when 'WARNING' then 3 else 4 end,
       updated_at desc limit 20`,
    );
    if (!result.rows.length) return reply('Aucun incident actif.');
    const first = result.rows[0]!;
    return reply(
      `Incidents actifs\n${result.rows.map((row) => `- ${row.public_id.slice(0, 16)} [${row.severity}/${row.status}]`).join('\n')}\nLes actions ci-dessous visent le premier incident.`,
      {
        targetReference: first.public_id.slice(0, 16),
        stateReference: stateTag(`${first.status}:${first.restart_count}:${first.updated_at}`),
        actions: ['INVESTIGATE', 'RESTART', 'IGNORE'],
      },
    );
  }

  private async manageIncident(argument: string | undefined, correlationId: string) {
    const { body, pin } = parsePin(argument);
    const callback = /^(INVESTIGATE|RESTART|IGNORE):([^:]+):([a-f0-9]{8})$/u.exec(body);
    const reference = callback?.[2] ?? exactReference(body);
    if (!reference) return reply('Usage : /incident <identifiant>.');
    const selected = await this.pool.query<{
      public_id: string;
      status: string;
      severity: string;
      restart_count: number;
      max_restarts: number;
      cooldown_until: string | null;
      sensitive: boolean;
      environment: string;
      project_id: string | null;
      updated_at: string;
    }>(
      `select i.public_id::text,i.status,i.severity,i.restart_count,m.max_restarts,
       i.cooldown_until::text,m.sensitive,m.environment,p.public_id::text project_id,i.updated_at::text
       from incidents i join monitor_definitions m on m.id=i.monitor_id
       left join projects p on p.id=m.project_id
       where i.public_id::text=$1 or i.public_id::text like $1||'%' order by i.updated_at desc limit 2`,
      [reference],
    );
    if (selected.rows.length !== 1) return reply('Incident introuvable ou ambigu.');
    const incident = selected.rows[0]!;
    const state = stateTag(`${incident.status}:${incident.restart_count}:${incident.updated_at}`);
    if (!callback) {
      return reply(
        `Incident ${incident.public_id.slice(0, 16)} [${incident.severity}/${incident.status}].`,
        {
          targetReference: incident.public_id.slice(0, 16),
          stateReference: state,
          actions: ['INVESTIGATE', 'RESTART', 'IGNORE'],
        },
      );
    }
    if (callback[3] !== state) return reply('Etat de l’incident modifie; rechargez la commande.');
    const action = callback[1];
    if (action === 'RESTART') {
      if (!pin)
        return reply(
          `Le redemarrage exige : /incident RESTART:${incident.public_id.slice(0, 16)}:${state} <PIN>.`,
        );
      if (incident.restart_count >= incident.max_restarts)
        return reply('Limite de redemarrages atteinte.');
      if (incident.cooldown_until && Date.parse(incident.cooldown_until) > Date.now())
        return reply('Cooldown de redemarrage encore actif.');
      if (!incident.project_id)
        return reply('Incident sans projet : redemarrage automatique refuse.');
      if (!this.strongApproval) throw new Error('telegram_pin_gate_unavailable');
      await this.strongApproval.authorize(`incident:restart:${incident.public_id}:${state}`, pin);
    }
    if (action === 'IGNORE') {
      const changed = await this.pool.query(
        `update incidents set status='IGNORED',resolved_at=now(),updated_at=now()
         where public_id=$1::uuid and status=$2 and restart_count=$3 and updated_at=$4::timestamptz`,
        [incident.public_id, incident.status, incident.restart_count, incident.updated_at],
      );
      if (changed.rowCount !== 1) return reply('Incident modifie simultanement; action annulee.');
    } else {
      const objective =
        action === 'RESTART'
          ? `Diagnostiquer puis redemarrer de facon controlee la cible de l incident ${incident.public_id}.`
          : `Diagnostiquer sans mutation l incident ${incident.public_id} et produire des preuves.`;
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        const changed = await client.query<{ id: string }>(
          `update incidents set status='INVESTIGATING',
           restart_count=restart_count+case when $2='RESTART' then 1 else 0 end,
           cooldown_until=case when $2='RESTART' then now()+interval '5 minutes' else cooldown_until end,
           updated_at=now() where public_id=$1::uuid and status=$3 and restart_count=$4
           and updated_at=$5::timestamptz returning id::text`,
          [
            incident.public_id,
            action,
            incident.status,
            incident.restart_count,
            incident.updated_at,
          ],
        );
        const changedIncident = changed.rows[0];
        if (!changedIncident) {
          await client.query('rollback');
          return reply('Incident modifie simultanement; action annulee.');
        }
        const mission = await client.query<{ public_id: string }>(
          `with owner as(select id from users where role='OWNER' and status='ACTIVE' order by id limit 1),
           project as(select id,primary_machine_id from projects where public_id=$2::uuid and status='ACTIVE')
           insert into missions(user_id,project_id,machine_id,prompt_initial,normalized_goal,status,
             data_classification,context,success_criteria,definition_of_done,queued_at)
           select owner.id,project.id,project.primary_machine_id,$1,$1,'QUEUED','LOCAL_ONLY',
             jsonb_build_object('source','INCIDENT','incidentId',$3::text),
             '["Diagnostic verifie"]'::jsonb,'["Rapport et preuves disponibles"]'::jsonb,now()
           from owner cross join project where project.primary_machine_id is not null returning public_id::text`,
          [objective, incident.project_id, incident.public_id],
        );
        const queued = mission.rows[0];
        if (!queued) throw new Error('incident_project_or_machine_unavailable');
        await client.query(
          `insert into incident_events(incident_id,event_type,actor,payload_sanitized)
           values($1::bigint,$2,'telegram',jsonb_build_object('missionId',$3::text))`,
          [changedIncident.id, action, queued.public_id],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        if (error instanceof Error && error.message === 'incident_project_or_machine_unavailable')
          return reply('Projet ou machine indisponible; mission non creee.');
        throw error;
      } finally {
        client.release();
      }
    }
    await this.audit(
      `INCIDENT_${action}`,
      correlationId,
      { incidentId: incident.public_id },
      action === 'RESTART' ? 'HIGH' : 'LOW',
    );
    return reply(
      action === 'IGNORE'
        ? 'Incident ignore sans supprimer son historique.'
        : `Mission ${action === 'RESTART' ? 'de redemarrage controle' : 'd investigation'} ajoutee a la file.`,
    );
  }

  private async forgetProject(argument: string | undefined, correlationId: string) {
    const { body, pin } = parsePin(argument);
    const callback = /^PURGE_MEMORY:([^:]+):([a-f0-9]{8})$/u.exec(body);
    const reference = callback?.[1] ?? exactReference(body);
    if (!reference) return reply('Usage : /forget <projet>.');
    const selected = await this.pool.query<{
      public_id: string;
      revision: string;
    }>(
      `select public_id::text,md5(updated_at::text||coalesce(manifest_version::text,'')) revision
       from projects where public_id::text=$1 or public_id::text like $1||'%' or name=$1
       order by updated_at desc limit 2`,
      [reference],
    );
    if (selected.rows.length !== 1) return reply('Projet introuvable ou ambigu.');
    const project = selected.rows[0]!;
    const state = project.revision.slice(0, 8);
    if (!callback) {
      return reply(
        'La purge supprimera la connaissance derivee du projet. Confirmez d’abord cette cible.',
        {
          targetReference: project.public_id.slice(0, 16),
          stateReference: state,
          actions: ['PURGE_MEMORY'],
        },
      );
    }
    if (callback[2] !== state)
      return reply('Projet modifie; la confirmation de purge est obsolete.');
    if (!pin)
      return reply(
        `PIN requis : /forget PURGE_MEMORY:${project.public_id.slice(0, 16)}:${state} <PIN>.`,
      );
    if (!this.strongApproval || !this.dataRoot)
      return reply('Purge forte indisponible dans ce runtime.');
    await this.strongApproval.authorize(`memory:purge:${project.public_id}:${state}`, pin);
    const database = await new KnowledgeStoreRepository(this.pool).purgeProject(
      project.public_id,
      'telegram_owner_request',
    );
    const artifacts = await new LocalDerivedKnowledgeArtifactStore(
      join(this.dataRoot, 'knowledge'),
    ).purgeProject(project.public_id);
    await this.audit(
      'KNOWLEDGE_PROJECT_PURGED',
      correlationId,
      { projectId: project.public_id, database, artifacts },
      'CRITICAL',
    );
    return reply(
      `Purge terminee : ${database.sources} sources, ${database.chunks} chunks, ${database.embeddings} embeddings, ${database.entries} entrees et ${artifacts.files} fichiers derives.`,
    );
  }

  private async audit(
    action: string,
    correlationId: string,
    parameters: Readonly<Record<string, unknown>>,
    risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  ): Promise<void> {
    await this.pool.query(
      `select append_audit_log('TELEGRAM',$1,$2::uuid,$3::jsonb,$4::jsonb,$5)`,
      [
        action,
        correlationId,
        JSON.stringify(parameters),
        JSON.stringify({ status: 'COMPLETED' }),
        risk,
      ],
    );
  }
}
