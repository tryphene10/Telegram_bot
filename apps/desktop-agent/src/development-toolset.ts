import {
  objectSchema,
  type GitTestEvidence,
  type GitWorkspaceBaseline,
  type ToolDefinition,
  type ToolAuthorization,
  type ToolRegistry,
  type ToolRisk,
} from '@arcc/tools';
import type { ControlledDockerService } from './docker-service.js';
import type { ControlledGitService } from './git-service.js';

type Data = Record<string, unknown>;

function isData(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Data, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function strings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function baseline(value: unknown): value is GitWorkspaceBaseline {
  return (
    isData(value) &&
    /^[a-f0-9]{64}$/u.test(String(value.hash)) &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) =>
        isData(entry) &&
        typeof entry.path === 'string' &&
        typeof entry.index === 'string' &&
        typeof entry.worktree === 'string',
    )
  );
}

function evidence(value: unknown): value is readonly GitTestEvidence[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isData(item) &&
        typeof item.commandHash === 'string' &&
        typeof item.exitCode === 'number' &&
        typeof item.completedAt === 'string',
    )
  );
}

function register(
  registry: ToolRegistry,
  name: string,
  risk: ToolRisk,
  validate: (value: Data) => boolean,
  execute: (value: Data, signal: AbortSignal, authorization: ToolAuthorization) => Promise<Data>,
): void {
  const definition: ToolDefinition<Data, Data> = {
    name,
    risk,
    limits: { timeoutMs: 900_000, maxInputBytes: 1024 * 1024, maxOutputBytes: 10 * 1024 * 1024 },
    input: objectSchema<Data>((value): value is Data => validate(value)),
    output: objectSchema<Data>((value): value is Data => isData(value)),
    execute: (value, context) => execute(value, context.signal, context.authorization),
  };
  registry.register(definition);
}

export function registerDevelopmentTools(
  registry: ToolRegistry,
  services: { readonly git?: ControlledGitService; readonly docker?: ControlledDockerService },
): void {
  const git = services.git;
  const docker = services.docker;
  if (git) {
    register(
      registry,
      'git.read',
      'LOW',
      (value) =>
        onlyKeys(value, ['operation', 'staged', 'paths', 'limit']) &&
        ['STATUS', 'DIFF', 'LOG', 'BRANCHES', 'WORKTREES', 'BASELINE'].includes(
          String(value.operation),
        ) &&
        (value.staged === undefined || typeof value.staged === 'boolean') &&
        (value.paths === undefined || strings(value.paths)) &&
        (value.limit === undefined || typeof value.limit === 'number'),
      async (value, signal) => {
        const operation = String(value.operation);
        if (operation === 'STATUS') return { output: await git.status(signal) };
        if (operation === 'DIFF') {
          return {
            output: await git.diff(
              {
                ...(value.staged === undefined ? {} : { staged: value.staged as boolean }),
                ...(value.paths === undefined ? {} : { paths: value.paths as readonly string[] }),
              },
              signal,
            ),
          };
        }
        if (operation === 'LOG')
          return {
            output: await git.log((value.limit as number | undefined) ?? 20, signal),
          };
        if (operation === 'BRANCHES') return { output: await git.branches(signal) };
        if (operation === 'WORKTREES') return { output: await git.worktrees(signal) };
        return { baseline: await git.captureBaseline(signal) };
      },
    );

    register(
      registry,
      'git.worktree',
      'MEDIUM',
      (value) =>
        onlyKeys(value, ['operation', 'path', 'branch', 'create']) &&
        ['ADD', 'REMOVE'].includes(String(value.operation)) &&
        typeof value.path === 'string' &&
        (value.branch === undefined || typeof value.branch === 'string') &&
        (value.create === undefined || typeof value.create === 'boolean'),
      async (value, signal) => {
        if (value.operation === 'ADD') {
          if (typeof value.branch !== 'string') throw new Error('worktree_branch_required');
          await git.addWorktree(String(value.path), value.branch, Boolean(value.create), signal);
        } else {
          await git.removeWorktree(String(value.path), signal);
        }
        return { ok: true };
      },
    );

    register(
      registry,
      'git.stage',
      'MEDIUM',
      (value) =>
        onlyKeys(value, ['paths', 'baseline', 'baselineHash', 'includePreexisting']) &&
        strings(value.paths) &&
        baseline(value.baseline) &&
        typeof value.baselineHash === 'string' &&
        (value.includePreexisting === undefined || strings(value.includePreexisting)),
      async (value, signal) => {
        await git.stage(
          {
            paths: value.paths as readonly string[],
            baseline: value.baseline as unknown as GitWorkspaceBaseline,
            baselineHash: String(value.baselineHash),
            ...(value.includePreexisting === undefined
              ? {}
              : { includePreexisting: value.includePreexisting as readonly string[] }),
          },
          signal,
        );
        return { ok: true };
      },
    );

    register(
      registry,
      'git.commit',
      'HIGH',
      (value) =>
        onlyKeys(value, ['message', 'expectedDiffHash', 'tests']) &&
        typeof value.message === 'string' &&
        typeof value.expectedDiffHash === 'string' &&
        evidence(value.tests),
      async (value, signal) => ({
        output: await git.commit(
          {
            message: String(value.message),
            expectedDiffHash: String(value.expectedDiffHash),
            tests: value.tests as unknown as readonly GitTestEvidence[],
          },
          signal,
        ),
      }),
    );

    register(
      registry,
      'git.branch',
      'MEDIUM',
      (value) =>
        onlyKeys(value, ['branch', 'create']) &&
        typeof value.branch === 'string' &&
        typeof value.create === 'boolean',
      async (value, signal) => {
        await git.switchBranch(String(value.branch), Boolean(value.create), signal);
        return { ok: true };
      },
    );

    for (const operation of ['pull', 'push'] as const) {
      register(
        registry,
        `git.${operation}`,
        'HIGH',
        (value) =>
          onlyKeys(value, ['remote', 'branch']) &&
          typeof value.remote === 'string' &&
          typeof value.branch === 'string',
        async (value, signal) => {
          await git[operation](String(value.remote), String(value.branch), signal);
          return { ok: true };
        },
      );
    }

    register(
      registry,
      'git.reset',
      'CRITICAL',
      (value) =>
        onlyKeys(value, ['reference', 'mode']) &&
        typeof value.reference === 'string' &&
        ['SOFT', 'MIXED', 'HARD'].includes(String(value.mode)),
      async (value, signal) => {
        await git.reset(String(value.reference), value.mode as 'SOFT' | 'MIXED' | 'HARD', signal);
        return { ok: true };
      },
    );
  }
  if (docker) {
    register(
      registry,
      'docker.read',
      'LOW',
      (value) =>
        onlyKeys(value, ['operation', 'service', 'tail']) &&
        ['PS', 'LOGS', 'INSPECT'].includes(String(value.operation)) &&
        (value.service === undefined || typeof value.service === 'string') &&
        (value.tail === undefined || typeof value.tail === 'number'),
      async (value, signal) => {
        const operation = String(value.operation);
        if (operation === 'PS') return { output: await docker.ps(signal) };
        if (operation === 'LOGS') {
          return {
            output: await docker.logs(
              String(value.service),
              (value.tail as number | undefined) ?? 200,
              signal,
            ),
          };
        }
        return { output: await docker.inspect(String(value.service), signal) };
      },
    );

    register(
      registry,
      'docker.build',
      'HIGH',
      (value) => onlyKeys(value, ['service']) && typeof value.service === 'string',
      async (value, signal) => {
        await docker.build(String(value.service), signal);
        return { ok: true };
      },
    );

    register(
      registry,
      'docker.control',
      'MEDIUM',
      (value) =>
        onlyKeys(value, ['operation', 'services']) &&
        ['UP', 'STOP', 'RESTART', 'DOWN'].includes(String(value.operation)) &&
        strings(value.services),
      async (value, signal, authorization) => {
        if (
          docker.environment === 'PRODUCTION' &&
          authorization.decision !== 'REQUIRE_STRONG_APPROVAL'
        ) {
          throw new Error('production_strong_approval_required');
        }
        await docker.control(
          value.operation as 'UP' | 'STOP' | 'RESTART' | 'DOWN',
          value.services as readonly string[],
          signal,
        );
        return { ok: true };
      },
    );

    register(
      registry,
      'docker.publish',
      'CRITICAL',
      (value) => onlyKeys(value, ['image']) && typeof value.image === 'string',
      async (value, signal) => {
        await docker.publish(String(value.image), signal);
        return { ok: true };
      },
    );
  }
}
