import { hostname } from 'node:os';
import { basename, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

interface RuntimeConfiguration {
  readonly firstProject?: string;
  readonly localModel: string;
}

export async function bootstrapLocalRuntime(databaseUrl: string, dataRoot: string): Promise<void> {
  const configuration = JSON.parse(
    await readFile(join(dataRoot, 'config.json'), 'utf8'),
  ) as RuntimeConfiguration;
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query('begin');
    await pool.query(`select pg_advisory_xact_lock(hashtext('arcc.bootstrap.owner'))`);
    const owner = await pool.query<{ id: string }>(
      `insert into users(display_name,role,status)
       select 'Owner local','OWNER','ACTIVE'
       where not exists(select 1 from users where role='OWNER' and status='ACTIVE')
       returning id`,
    );
    const ownerId =
      owner.rows[0]?.id ??
      (
        await pool.query<{ id: string }>(
          `select id from users where role='OWNER' and status='ACTIVE' order by id limit 1`,
        )
      ).rows[0]?.id;
    if (!ownerId) throw new Error('owner_bootstrap_failed');
    const machine = await pool.query<{ id: string }>(
      `insert into machines(owner_id,name,hostname,os,architecture,agent_version,status,paired_at,last_heartbeat_at) values($1,$2,$2,'Windows', $3,'0.1.0-rc.1','ONLINE',now(),now()) on conflict(owner_id,name) do update set status='ONLINE',last_heartbeat_at=now(),updated_at=now() returning id`,
      [ownerId, hostname(), process.arch],
    );
    const machineId = machine.rows[0]?.id;
    if (!machineId) throw new Error('machine_bootstrap_failed');
    if (configuration.firstProject) {
      await pool.query(
        `insert into projects(owner_id,primary_machine_id,name,root_path,status) values($1,$2,$3,$4,'ACTIVE') on conflict(owner_id,root_path) do update set primary_machine_id=excluded.primary_machine_id,status='ACTIVE',updated_at=now()`,
        [ownerId, machineId, basename(configuration.firstProject), configuration.firstProject],
      );
    }
    await pool.query(
      `insert into model_catalog(provider,model,enabled,available,maximum_classification,context_tokens,maximum_output_tokens,capabilities) values('LOCAL',$1,true,true,'SECRET',32768,4096,'{}') on conflict(provider,model) do update set enabled=true,available=true,updated_at=now()`,
      [configuration.localModel],
    );
    await pool.query('commit');
  } catch (error) {
    await pool.query('rollback');
    throw error;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('bootstrap.js')) {
  const databaseUrl = process.env.DATABASE_URL;
  const dataRoot = process.env.ARCC_DATA_ROOT;
  if (!databaseUrl || !dataRoot) throw new Error('DATABASE_URL and ARCC_DATA_ROOT are required');
  await bootstrapLocalRuntime(databaseUrl, dataRoot);
  console.log(JSON.stringify({ event: 'runtime.bootstrap.completed' }));
}
