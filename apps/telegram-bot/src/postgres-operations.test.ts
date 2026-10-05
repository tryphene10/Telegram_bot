import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { PostgresTelegramOperations } from './postgres-operations.js';

describe('PostgresTelegramOperations metadata projections', () => {
  it('returns queue identifiers and states without mission objectives', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            public_id: '11111111-1111-4111-8111-111111111111',
            status: 'QUEUED',
            normalized_goal: 'objectif qui ne doit pas sortir',
          },
        ],
        rowCount: 1,
      })),
    } as unknown as Pool;
    const result = await new PostgresTelegramOperations(pool).invoke({ command: 'queue' });
    expect(result.text).toContain('11111111-1111-4');
    expect(result.text).toContain('QUEUED');
    expect(result.text).not.toContain('objectif');
  });

  it('filters SECRET files and returns no file names', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          public_id: '22222222-2222-4222-8222-222222222222',
          size_bytes: '42',
          classification: 'LOCAL_ONLY',
        },
      ],
      rowCount: 1,
    }));
    const result = await new PostgresTelegramOperations({ query } as unknown as Pool).invoke({
      command: 'files',
    });
    expect(String(query.mock.calls[0]?.[0])).toContain("classification<>'SECRET'");
    expect(result.text).toContain('22222222-2222-4');
    expect(result.text).not.toContain('.env');
  });
});

describe('PostgresTelegramOperations administration', () => {
  it('binds retry to the exact mission state before requeueing', async () => {
    const mission = {
      public_id: '11111111-1111-4111-8111-111111111111',
      status: 'BLOCKED',
      version: 7,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('select public_id::text,status,version from missions'))
        return { rows: [mission], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const operations = new PostgresTelegramOperations({ query } as unknown as Pool);
    const confirmation = await operations.invoke({ command: 'retry', argument: '11111111' });
    expect(confirmation.actions).toEqual(['RETRY']);
    await expect(
      operations.invoke({
        command: 'retry',
        argument: `RETRY:${confirmation.targetReference}:${confirmation.stateReference}`,
      }),
    ).resolves.toMatchObject({ text: expect.stringContaining('file') });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("set status='QUEUED'"))).toBe(
      true,
    );
  });

  it('requires and consumes a PIN before autonomous scheduler mode', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('select autonomy_level autonomy'))
        return { rows: [{ autonomy: 'EXECUTE_SAFE', generation: '4' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const gate = { authorize: vi.fn(async () => undefined) };
    const operations = new PostgresTelegramOperations({ query } as unknown as Pool, gate);
    const prompt = await operations.invoke({ command: 'autonomy', argument: 'AUTONOMOUS' });
    expect(prompt.text).toContain('PIN');
    await operations.invoke({ command: 'autonomy', argument: 'AUTONOMOUS 123456' });
    expect(gate.authorize).toHaveBeenCalledWith('autonomy:AUTONOMOUS:4', '123456');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('set autonomy_level=$1'))).toBe(
      true,
    );
  });

  it('creates validated schedules paused and never enables them implicitly', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('insert into scheduled_tasks'))
        return {
          rows: [{ public_id: '22222222-2222-4222-8222-222222222222' }],
          rowCount: 1,
        };
      return { rows: [], rowCount: 1 };
    });
    const result = await new PostgresTelegramOperations({ query } as unknown as Pool).invoke({
      command: 'schedule',
      argument: JSON.stringify({
        name: 'hourly-check',
        project: 'project-1',
        triggerType: 'INTERVAL',
        expression: 'PT1H',
        objective: 'Verifier la sante locale',
      }),
    });
    expect(result.text).toContain('creee en pause');
    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes('insert into scheduled_tasks'),
    );
    expect(String(insert?.[0])).toContain("'EXECUTE_SAFE','PAUSED'");
  });

  it('does not restart an incident without a fresh PIN', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from incidents i join monitor_definitions'))
        return {
          rows: [
            {
              public_id: '33333333-3333-4333-8333-333333333333',
              status: 'OPEN',
              severity: 'ERROR',
              restart_count: 0,
              max_restarts: 1,
              cooldown_until: null,
              sensitive: false,
              environment: 'LOCAL',
              project_id: '44444444-4444-4444-8444-444444444444',
              updated_at: '2026-10-02T10:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 1 };
    });
    const operations = new PostgresTelegramOperations({ query } as unknown as Pool);
    const prepared = await operations.invoke({ command: 'incident', argument: '33333333' });
    const result = await operations.invoke({
      command: 'incident',
      argument: `RESTART:${prepared.targetReference}:${prepared.stateReference}`,
    });
    expect(result.text).toContain('PIN');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into missions'))).toBe(
      false,
    );
  });

  it('refuses an ambiguous approval prefix before any update', async () => {
    const query = vi.fn(async () => ({
      rows: [{ public_id: 'a' }, { public_id: 'b' }],
      rowCount: 2,
    }));
    const result = await new PostgresTelegramOperations({ query } as unknown as Pool).invoke({
      command: 'reject',
      argument: 'deadbeef',
    });
    expect(result.text).toContain('ambigue');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
