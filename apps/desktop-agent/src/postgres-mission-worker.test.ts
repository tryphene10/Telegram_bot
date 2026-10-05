import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import type { ToolRegistry } from '@arcc/tools';
import {
  PostgresMissionWorker,
  type MissionRow,
  type StepRow,
  type WorkerBrain,
} from './postgres-mission-worker.js';

const mission: MissionRow = {
  id: '1',
  public_id: '11111111-1111-4111-8111-111111111111',
  status: 'PLANNING',
  normalized_goal: 'Inspecter le projet sans le modifier',
  context: {},
  success_criteria: ['inspection terminee'],
  definition_of_done: ['rapport disponible'],
  data_classification: 'LOCAL_ONLY',
  requested_provider: 'LOCAL',
  requested_model: 'LOCAL:test-model',
  plan: null,
  version: 2,
  user_id: '1',
  user_public_id: '22222222-2222-4222-8222-222222222222',
  user_status: 'ACTIVE',
  project_id: '1',
  project_public_id: '33333333-3333-4333-8333-333333333333',
  project_status: 'ACTIVE',
  root_path: 'D:\\safe-project',
  manifest: null,
  machine_id: '1',
  machine_public_id: '44444444-4444-4444-8444-444444444444',
  machine_status: 'ONLINE',
};

const step: StepRow = {
  id: '1',
  public_id: '55555555-5555-4555-8555-555555555555',
  logical_id: 'inspect',
  title: 'Inspecter',
  agent_key: 'SECURITY_REVIEWER',
  status: 'PENDING',
  attempts: 0,
  max_attempts: 2,
  loop_count: 0,
  max_loops: 2,
  maximum_tool_calls: 2,
  exit_criteria: ['inspection terminee'],
  result_sanitized: null,
};

describe('PostgresMissionWorker', () => {
  it('exposes advanced tools only from an identity-bound explicit manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcc-worker-'));
    const git = join(root, 'git.exe');
    const docker = join(root, 'docker.exe');
    const chrome = join(root, 'chrome.exe');
    const code = join(root, 'Code.exe');
    await Promise.all([git, docker, chrome, code].map((path) => writeFile(path, 'test')));
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Pool;
    const brain = {} as WorkerBrain;
    const worker = new PostgresMissionWorker(pool, brain, 'worker-test', 1_000, root);
    const configured: MissionRow = {
      ...mission,
      root_path: root,
      manifest: {
        version: 1,
        projectId: mission.project_public_id,
        machineId: mission.machine_public_id,
        rootPath: root,
        stack: [],
        environments: ['LOCAL'],
        commands: {},
        allowedPaths: ['.'],
        deniedPaths: ['.git'],
        protectedFiles: ['.env'],
        directoryLimits: { '.': { maxFiles: 100, maxBytes: 1024 * 1024 } },
        git: { enabled: true, executablePath: git },
        docker: {
          executablePath: docker,
          projectName: 'sandbox',
          composeFiles: ['compose.yaml'],
          services: ['api'],
          imagePrefixes: ['example/arcc'],
          environment: 'DEVELOPMENT',
        },
        browser: {
          executablePath: chrome,
          allowedDomains: ['example.com'],
          headless: true,
        },
        computerUse: {
          applications: [
            {
              appKey: 'editor',
              executablePath: code,
              windowTitlePrefixes: ['Sandbox - '],
            },
          ],
        },
      },
    };
    try {
      const registry = (
        worker as unknown as { registry(value: MissionRow): ToolRegistry }
      ).registry(configured);
      const names = registry.descriptors().map(({ name }) => name);
      expect(names).toEqual(
        expect.arrayContaining([
          'git.read',
          'docker.read',
          'browser.read',
          'browser.external',
          'computer.observe',
          'computer.input',
        ]),
      );
      const mismatched = (
        worker as unknown as { registry(value: MissionRow): ToolRegistry }
      ).registry({
        ...configured,
        manifest: { ...(configured.manifest as Record<string, unknown>), projectId: 'wrong' },
      });
      expect(mismatched.descriptors().some(({ name }) => name.startsWith('git.'))).toBe(false);
    } finally {
      await worker.closeRuntime();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists a complete mission lifecycle without bypassing the durable store', async () => {
    let nextStepCalls = 0;
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('with candidate as') && sql.includes("status='QUEUED'")) {
        return { rows: [mission], rowCount: 1 };
      }
      if (sql.includes('insert into project_execution_leases')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('from mission_steps s where')) {
        nextStepCalls += 1;
        return { rows: nextStepCalls === 1 ? [step] : [], rowCount: nextStepCalls === 1 ? 1 : 0 };
      }
      if (sql.includes('from mission_steps where')) {
        return {
          rows: [{ ...step, status: 'COMPLETED', result_sanitized: { summary: 'ok' } }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
    const brain: WorkerBrain = {
      plan: vi.fn(async () => [
        {
          id: 'inspect',
          title: 'Inspecter',
          dependencies: [],
          maxAttempts: 2,
          maxLoops: 2,
          maximumToolCalls: 2,
          exitCriteria: ['inspection terminee'],
          agentKey: 'SECURITY_REVIEWER',
        },
      ]),
      propose: vi.fn(async () => ({
        summary: 'ok',
        actions: [],
        facts: ['lu'],
        hypotheses: [],
        risks: [],
      })),
      verify: vi.fn(async () => ({
        passed: true,
        evidence: ['step:inspect'],
        report: 'Mission verifiee.',
      })),
    };

    await expect(
      new PostgresMissionWorker(pool, brain, 'worker-test').runOnce(new AbortController().signal),
    ).resolves.toBe(true);

    expect(brain.plan).toHaveBeenCalledOnce();
    expect(brain.propose).toHaveBeenCalledOnce();
    expect(brain.verify).toHaveBeenCalledOnce();
    expect(
      statements.some(
        (sql) =>
          sql.includes('execution_epoch=m.execution_epoch+1') &&
          sql.includes('version=m.version+1'),
      ),
    ).toBe(true);
    expect(statements.some((sql) => sql.includes("set status='COMPLETED',final_report"))).toBe(
      true,
    );
    expect(statements.some((sql) => sql.includes('delete from project_execution_leases'))).toBe(
      true,
    );
  });
});
