import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import { promisify } from 'node:util';
import { SchedulerRepository } from '@arcc/database';
import { PolicyEngine, type PolicyInput } from '@arcc/policies';
import {
  LocalMonitorProbeAdapter,
  MonitorRunner,
  SchedulerRuntime,
  SchedulerWorker,
  type MonitorDefinition,
} from '@arcc/scheduler';
import { Pool } from 'pg';

const execFileAsync = promisify(execFile);

function probeLocalHttp(
  rawUrl: string,
  timeoutMs: number,
): Promise<{ readonly statusCode: number; readonly latencyMs: number }> {
  return new Promise((resolve, reject) => {
    const url = new URL(rawUrl);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      reject(new Error('http_target_not_local'));
      return;
    }
    const started = Date.now();
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      { method: 'HEAD', timeout: timeoutMs },
      (response) => {
        response.resume();
        resolve({ statusCode: response.statusCode ?? 0, latencyMs: Date.now() - started });
      },
    );
    request.once('timeout', () => request.destroy(new Error('http_probe_timeout')));
    request.once('error', reject);
    request.end();
  });
}

function safeText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function classification(value: unknown): PolicyInput['classification'] {
  return ['PUBLIC', 'CLOUD_SAFE', 'LOCAL_ONLY', 'SECRET'].includes(String(value))
    ? (value as PolicyInput['classification'])
    : 'LOCAL_ONLY';
}

export class PostgresOperationsRuntime {
  private readonly repository: SchedulerRepository;
  private readonly workerId = `operations-${process.pid}`;

  constructor(private readonly pool: Pool) {
    this.repository = new SchedulerRepository(pool);
  }

  async run(signal: AbortSignal): Promise<void> {
    const scheduler = this.scheduler();
    await Promise.all([scheduler.run(signal), this.runMonitors(signal)]);
  }

  private scheduler(): SchedulerRuntime {
    const policy = new PolicyEngine({
      record: async (event) => {
        console.log(JSON.stringify({ event: 'scheduler.policy', ...event }));
      },
    });
    const worker = new SchedulerWorker(
      this.repository,
      {
        evaluate: async (occurrence) =>
          policy.evaluate({
            userId: 'scheduler-owner',
            userStatus: 'ACTIVE',
            projectId: occurrence.projectId ?? 'scheduler-global',
            projectStatus: 'ACTIVE',
            machineId: 'local-machine',
            machineStatus: 'ONLINE',
            tool: { key: 'scheduler.mission.create', risk: occurrence.risk, enabled: true },
            parameters: occurrence.missionTemplate,
            environment: 'LOCAL',
            classification: classification(occurrence.missionTemplate.classification),
            actionCategory: 'PERSISTENT_PROCESS',
            evaluationHealthy: true,
            connectionAvailable: true,
          }),
      },
      { execute: (input) => this.enqueueScheduledMission(input) },
      { record: async (event) => console.log(JSON.stringify(event)) },
      this.workerId,
    );
    return new SchedulerRuntime(this.repository, worker, {
      record: async (event) => console.log(JSON.stringify(event)),
    });
  }

  private async enqueueScheduledMission(input: {
    readonly idempotencyKey: string;
    readonly occurrenceId: string;
    readonly projectId?: string;
    readonly missionTemplate: Readonly<Record<string, unknown>>;
  }): Promise<Readonly<Record<string, unknown>>> {
    const objective = safeText(
      input.missionTemplate.objective ?? input.missionTemplate.prompt,
      4_000,
    );
    if (!objective) throw new Error('scheduled_objective_required');
    const result = await this.pool.query<{ public_id: string; status: string }>(
      `with owner as (
         select id from users where role='OWNER' and status='ACTIVE' order by id limit 1
       ), project as (
         select id,primary_machine_id from projects
         where status='ACTIVE' and ($4::text is null or public_id::text=$4)
         order by id limit 1
       )
       insert into missions(
         user_id,project_id,machine_id,prompt_initial,normalized_goal,status,
         data_classification,requested_provider,requested_model,context,
         success_criteria,definition_of_done,idempotency_key,queued_at
       )
       select owner.id,project.id,project.primary_machine_id,$1,$1,'QUEUED',$5,$6,$7,
              jsonb_build_object('source','SCHEDULER','occurrenceId',$3::text),$8::jsonb,$9::jsonb,$2,now()
       from owner cross join project
       on conflict(idempotency_key) do update set idempotency_key=missions.idempotency_key
       returning public_id,status`,
      [
        objective,
        input.idempotencyKey,
        input.occurrenceId,
        input.projectId ?? null,
        classification(input.missionTemplate.classification),
        safeText(input.missionTemplate.provider, 64) || null,
        safeText(input.missionTemplate.model, 200) || null,
        JSON.stringify(
          Array.isArray(input.missionTemplate.successCriteria)
            ? input.missionTemplate.successCriteria
            : ['Objectif planifie traite'],
        ),
        JSON.stringify(
          Array.isArray(input.missionTemplate.definitionOfDone)
            ? input.missionTemplate.definitionOfDone
            : ['Rapport final disponible'],
        ),
      ],
    );
    const mission = result.rows[0];
    if (!mission) throw new Error('scheduled_project_unavailable');
    return { missionId: mission.public_id, status: mission.status };
  }

  private async runMonitors(signal: AbortSignal): Promise<void> {
    const runner = new MonitorRunner(this.monitorProbe(), this.repository);
    while (!signal.aborted) {
      const definition = await this.repository.claimMonitor(this.workerId, 60);
      if (!definition) {
        await this.wait(signal, 1_000);
        continue;
      }
      try {
        const evaluation = await runner.run(definition);
        if (evaluation.transition !== 'NONE') {
          await this.enqueueMonitorNotification(definition, evaluation.transition);
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'monitor.worker.error',
            monitorId: definition.id,
            error: error instanceof Error ? error.message : 'unknown',
          }),
        );
      } finally {
        await this.repository.releaseMonitor(definition.id, this.workerId);
      }
    }
  }

  private monitorProbe(): LocalMonitorProbeAdapter {
    return new LocalMonitorProbeAdapter(
      {
        authorize: async (url) => ['127.0.0.1', 'localhost'].includes(url.hostname),
        probe: probeLocalHttp,
      },
      {
        process: async (name) => {
          const result = await execFileAsync(
            'tasklist.exe',
            ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'],
            {
              windowsHide: true,
              timeout: 5_000,
            },
          );
          return result.stdout.toLowerCase().includes(name.toLowerCase());
        },
        service: async (name) => {
          try {
            const result = await execFileAsync('sc.exe', ['query', name], {
              windowsHide: true,
              timeout: 5_000,
            });
            return /STATE\s*:\s*4\s+RUNNING/iu.test(result.stdout);
          } catch {
            return false;
          }
        },
        tcp: (host, port, timeoutMs) =>
          new Promise((resolve) => {
            const started = Date.now();
            if (!['127.0.0.1', 'localhost'].includes(host)) {
              resolve({ available: false, latencyMs: 0 });
              return;
            }
            const socket = connect({ host, port });
            const finish = (available: boolean) => {
              socket.destroy();
              resolve({ available, latencyMs: Date.now() - started });
            };
            socket.setTimeout(timeoutMs, () => finish(false));
            socket.once('connect', () => finish(true));
            socket.once('error', () => finish(false));
          }),
      },
    );
  }

  private async enqueueMonitorNotification(
    definition: MonitorDefinition,
    transition: string,
  ): Promise<void> {
    await this.pool.query(
      `insert into notifications(user_id,channel,level,payload_sanitized,idempotency_key)
       select id,'TELEGRAM',case when $2 in('OPEN','REOPEN') then 'SECURITY' else 'NORMAL' end,
              jsonb_build_object('message',$3::text,'monitorId',$1::text,'transition',$2::text),$4
       from users where role='OWNER' and status='ACTIVE' order by id limit 1
       on conflict(idempotency_key) do nothing`,
      [
        definition.id,
        transition,
        `Monitoring ARCC : ${transition} pour ${definition.type} (${definition.id}).`,
        `monitor:${definition.id}:${transition}:${new Date().toISOString().slice(0, 16)}`,
      ],
    );
  }

  private async wait(signal: AbortSignal, milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      timer.unref?.();
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

export async function createPostgresOperationsRuntime(
  connectionString: string,
): Promise<{ runtime: PostgresOperationsRuntime; close(): Promise<void> }> {
  const pool = new Pool({ connectionString, max: 4, idleTimeoutMillis: 30_000 });
  await pool.query('select 1');
  return {
    runtime: new PostgresOperationsRuntime(pool),
    close: async () => pool.end(),
  };
}
