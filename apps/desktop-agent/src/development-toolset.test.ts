import { ToolRegistry } from '@arcc/tools';
import { describe, expect, it, vi } from 'vitest';
import { registerDevelopmentTools } from './development-toolset.js';

function services() {
  return {
    git: {
      status: vi.fn(async () => 'clean'),
      diff: vi.fn(async () => ''),
      log: vi.fn(async () => ''),
      branches: vi.fn(async () => ''),
      worktrees: vi.fn(async () => ''),
      addWorktree: vi.fn(async () => undefined),
      removeWorktree: vi.fn(async () => undefined),
      captureBaseline: vi.fn(async () => ({ entries: [], hash: 'a'.repeat(64) })),
      stage: vi.fn(async () => undefined),
      commit: vi.fn(async () => 'committed'),
      switchBranch: vi.fn(async () => undefined),
      pull: vi.fn(async () => undefined),
      push: vi.fn(async () => undefined),
      reset: vi.fn(async () => undefined),
    },
    docker: {
      environment: 'LOCAL',
      ps: vi.fn(async () => '[]'),
      logs: vi.fn(async () => ''),
      inspect: vi.fn(async () => '{}'),
      build: vi.fn(async () => undefined),
      control: vi.fn(async () => undefined),
      publish: vi.fn(async () => undefined),
    },
  };
}

describe('development tool registry', () => {
  it('can expose Git or Docker independently', () => {
    const values = services();
    const gitOnly = new ToolRegistry();
    registerDevelopmentTools(gitOnly, { git: values.git } as never);
    expect(gitOnly.descriptors().every(({ name }) => name.startsWith('git.'))).toBe(true);
    const dockerOnly = new ToolRegistry();
    registerDevelopmentTools(dockerOnly, { docker: values.docker } as never);
    expect(dockerOnly.descriptors().every(({ name }) => name.startsWith('docker.'))).toBe(true);
  });

  it('registers separate tools and risks, with no raw command surface', () => {
    const registry = new ToolRegistry();
    registerDevelopmentTools(registry, services() as never);
    expect(registry.descriptors().map(({ name, risk }) => `${name}:${risk}`)).toEqual([
      'git.read:LOW',
      'git.worktree:MEDIUM',
      'git.stage:MEDIUM',
      'git.commit:HIGH',
      'git.branch:MEDIUM',
      'git.pull:HIGH',
      'git.push:HIGH',
      'git.reset:CRITICAL',
      'docker.read:LOW',
      'docker.build:HIGH',
      'docker.control:MEDIUM',
      'docker.publish:CRITICAL',
    ]);
  });

  it('requires a strong approval for Docker control in production', async () => {
    const registry = new ToolRegistry();
    const values = services();
    values.docker.environment = 'PRODUCTION';
    registerDevelopmentTools(registry, values as never);
    await expect(
      registry.execute(
        'docker.control',
        { operation: 'RESTART', services: ['api'] },
        { decision: 'REQUIRE_APPROVAL', actionHash: 'c'.repeat(64), authorizationId: 'simple-1' },
      ),
    ).rejects.toThrow('production_strong_approval_required');
    expect(values.docker.control).not.toHaveBeenCalled();
  });

  it('rejects arbitrary arguments and requires consumed approval for push', async () => {
    const registry = new ToolRegistry();
    const values = services();
    registerDevelopmentTools(registry, values as never);
    await expect(
      registry.execute(
        'git.push',
        { remote: 'origin', branch: 'main', args: ['--force'] },
        {
          decision: 'REQUIRE_STRONG_APPROVAL',
          actionHash: 'a'.repeat(64),
          authorizationId: 'pin-1',
        },
      ),
    ).rejects.toThrow('invalid_input');
    await expect(
      registry.execute(
        'git.push',
        { remote: 'origin', branch: 'main' },
        { decision: 'REQUIRE_STRONG_APPROVAL', actionHash: 'a'.repeat(64) },
      ),
    ).rejects.toThrow('approval_not_consumed');
    expect(values.git.push).not.toHaveBeenCalled();
  });

  it('dispatches an approved scoped Docker operation', async () => {
    const registry = new ToolRegistry();
    const values = services();
    registerDevelopmentTools(registry, values as never);
    await expect(
      registry.execute(
        'docker.control',
        { operation: 'RESTART', services: ['api'] },
        { decision: 'REQUIRE_APPROVAL', actionHash: 'b'.repeat(64), authorizationId: 'approval-1' },
      ),
    ).resolves.toEqual({ ok: true });
    expect(values.docker.control).toHaveBeenCalledWith('RESTART', ['api'], expect.any(AbortSignal));
  });
});
