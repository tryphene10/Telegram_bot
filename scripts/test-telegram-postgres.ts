import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool as PgPool } from 'pg';
import { PostgresTelegramOperations } from '../apps/telegram-bot/src/postgres-operations.js';

const requireFromTelegramBot = createRequire(
  new URL('../apps/telegram-bot/package.json', import.meta.url),
);
const { Pool } = requireFromTelegramBot('pg') as { Pool: typeof PgPool };

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString });
  const dataRoot = await mkdtemp(join(tmpdir(), 'arcc-telegram-postgres-'));
  const authorized: string[] = [];
  const operations = new PostgresTelegramOperations(
    pool,
    {
      authorize: async (id, pin) => {
        assert.equal(pin, '123456');
        authorized.push(id);
      },
    },
    dataRoot,
  );

  try {
    const fixture = await pool.query<{
      user_id: string;
      machine_id: string;
      project_id: string;
      mission_id: string;
    }>(
      `with owner as(
       insert into users(display_name,role) values('telegram-admin-owner','OWNER') returning id
     ), machine as(
       insert into machines(owner_id,name,hostname,os,architecture,status)
       select id,'telegram-admin-machine','localhost','windows','x64','ONLINE' from owner returning id
     ), project as(
       insert into projects(owner_id,primary_machine_id,name,root_path,status)
       select owner.id,machine.id,'telegram-admin-project','C:\\Projects\\telegram-admin','ACTIVE'
       from owner cross join machine returning id,public_id
     ), mission as(
       insert into missions(user_id,project_id,machine_id,prompt_initial,normalized_goal,status,
         blocked_reason,blocked_action)
       select owner.id,project.id,machine.id,'fixture','fixture','BLOCKED',
         'fixture awaiting operator retry','Use /retry'
       from owner cross join project cross join machine returning id,public_id
     ) select owner.id::text user_id,machine.id::text machine_id,project.public_id::text project_id,
       mission.public_id::text mission_id from owner cross join machine cross join project cross join mission`,
    );
    const ids = fixture.rows[0];
    assert.ok(ids);

    const retry = await operations.invoke({
      command: 'retry',
      argument: ids.mission_id.slice(0, 12),
    });
    assert.deepEqual(retry.actions, ['RETRY']);
    await operations.invoke({
      command: 'retry',
      argument: `RETRY:${retry.targetReference}:${retry.stateReference}`,
    });
    assert.equal(
      (await pool.query(`select status from missions where public_id=$1::uuid`, [ids.mission_id]))
        .rows[0]?.status,
      'QUEUED',
    );

    const schedule = await operations.invoke({
      command: 'schedule',
      argument: JSON.stringify({
        name: 'telegram-admin-schedule',
        project: ids.project_id,
        triggerType: 'INTERVAL',
        expression: 'PT1H',
        objective: 'Verifier la sante du projet local',
      }),
    });
    assert.match(schedule.text, /creee en pause/u);
    const scheduleRow = await pool.query<{ public_id: string; status: string; enabled: boolean }>(
      `select public_id::text,status,enabled from scheduled_tasks where name='telegram-admin-schedule'`,
    );
    assert.equal(scheduleRow.rows[0]?.status, 'PAUSED');
    assert.equal(scheduleRow.rows[0]?.enabled, false);
    await operations.invoke({
      command: 'schedule_resume',
      argument: `${scheduleRow.rows[0]?.public_id.slice(0, 12)} 123456`,
    });
    assert.equal(
      (await pool.query(`select status from scheduled_tasks where name='telegram-admin-schedule'`))
        .rows[0]?.status,
      'ACTIVE',
    );

    await operations.invoke({ command: 'autonomy', argument: 'AUTONOMOUS 123456' });
    assert.equal(
      (await pool.query(`select autonomy_level from scheduler_control where singleton=true`))
        .rows[0]?.autonomy_level,
      'AUTONOMOUS',
    );
    await operations.invoke({ command: 'autonomy', argument: 'EXECUTE_SAFE' });

    const incident = await pool.query<{ public_id: string }>(
      `with monitor as(
       insert into monitor_definitions(user_id,project_id,name,monitor_type,target_sanitized,enabled)
       values($1::bigint,(select id from projects where public_id=$2::uuid),'telegram-admin-monitor',
         'TCP','{"host":"127.0.0.1","port":9}'::jsonb,true) returning id
     ) insert into incidents(monitor_id,incident_key,severity)
       select id,'telegram-admin-incident','ERROR' from monitor returning public_id::text`,
      [ids.user_id, ids.project_id],
    );
    const incidentView = await operations.invoke({
      command: 'incident',
      argument: incident.rows[0]!.public_id.slice(0, 12),
    });
    await operations.invoke({
      command: 'incident',
      argument: `IGNORE:${incidentView.targetReference}:${incidentView.stateReference}`,
    });
    assert.equal(
      (
        await pool.query(`select status from incidents where public_id=$1::uuid`, [
          incident.rows[0]!.public_id,
        ])
      ).rows[0]?.status,
      'IGNORED',
    );

    await pool.query(
      `insert into computer_use_sessions(mission_id,machine_id,status)
     values((select id from missions where public_id=$1::uuid),$2::bigint,'CREATED')`,
      [ids.mission_id, ids.machine_id],
    );
    const takeover = await operations.invoke({
      command: 'takeover',
      argument: ids.mission_id.slice(0, 12),
    });
    await operations.invoke({
      command: 'takeover',
      argument: `TAKEOVER:${takeover.targetReference}:${takeover.stateReference}`,
    });
    assert.equal(
      (
        await pool.query(
          `select control_mode from computer_use_sessions where mission_id=(select id from missions where public_id=$1::uuid)`,
          [ids.mission_id],
        )
      ).rows[0]?.control_mode,
      'TAKEOVER',
    );

    const approval = await pool.query<{ public_id: string }>(
      `insert into approvals(mission_id,action_key,action_hash,parameters_sanitized,level,expires_at)
     values((select id from missions where public_id=$1::uuid),'fixture',repeat('a',64),'{}','APPROVAL',now()+interval '15 minutes')
     returning public_id::text`,
      [ids.mission_id],
    );
    await operations.invoke({
      command: 'reject',
      argument: approval.rows[0]!.public_id.slice(0, 12),
    });
    assert.equal(
      (
        await pool.query(`select status from approvals where public_id=$1::uuid`, [
          approval.rows[0]!.public_id,
        ])
      ).rows[0]?.status,
      'REJECTED',
    );

    const forget = await operations.invoke({ command: 'forget', argument: ids.project_id });
    const purged = await operations.invoke({
      command: 'forget',
      argument: `PURGE_MEMORY:${forget.targetReference}:${forget.stateReference} 123456`,
    });
    assert.match(purged.text, /Purge terminee/u);
    assert.ok(authorized.some((id) => id.startsWith('memory:purge:')));
    console.log('Telegram PostgreSQL administration: OK');
  } finally {
    await pool.end();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
