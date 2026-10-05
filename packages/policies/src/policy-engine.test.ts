import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RISK_DECISIONS,
  PolicyEngine,
  hashPolicyAction,
  type ActionCategory,
  type PolicyInput,
  type RiskLevel,
} from './index.js';

const base: PolicyInput = {
  userId: 'user',
  userStatus: 'ACTIVE',
  projectId: 'project',
  projectStatus: 'ACTIVE',
  machineId: 'machine',
  machineStatus: 'ONLINE',
  tool: { key: 'tool', risk: 'LOW', enabled: true },
  parameters: { path: 'src/index.ts' },
  environment: 'LOCAL',
  classification: 'LOCAL_ONLY',
  actionCategory: 'READ',
  evaluationHealthy: true,
  connectionAvailable: true,
};

describe('PolicyEngine', () => {
  it.each(Object.entries(DEFAULT_RISK_DECISIONS) as [RiskLevel, string][])(
    'maps %s deterministically to %s',
    async (risk, expected) => {
      const engine = new PolicyEngine({ record: vi.fn() });
      const result = await engine.evaluate({ ...base, tool: { ...base.tool, risk } });
      expect(result.decision).toBe(expected);
    },
  );

  it.each([
    'PUSH',
    'PRODUCTION',
    'PUBLICATION',
    'PAYMENT',
    'IRREVERSIBLE_DELETE',
    'DEPENDENCY_INSTALL',
    'NETWORK_ACCESS',
    'GIT_COMMIT',
  ] as ActionCategory[])('always requires strong approval for %s', async (actionCategory) => {
    const engine = new PolicyEngine({ record: vi.fn() });
    expect((await engine.evaluate({ ...base, actionCategory })).decision).toBe(
      'REQUIRE_STRONG_APPROVAL',
    );
  });

  it('requires a simple approval for a persistent medium-risk process', async () => {
    const engine = new PolicyEngine({ record: vi.fn() });
    const result = await engine.evaluate({
      ...base,
      tool: { key: 'terminal.persistent', risk: 'MEDIUM', enabled: true },
      actionCategory: 'PERSISTENT_PROCESS',
    });
    expect(result.decision).toBe('REQUIRE_APPROVAL');
  });

  it('fails closed on connection loss or evaluation error', async () => {
    const engine = new PolicyEngine({ record: vi.fn() });
    expect((await engine.evaluate({ ...base, connectionAvailable: false })).decision).toBe('DENY');
    expect((await engine.evaluate({ ...base, evaluationHealthy: false })).decision).toBe('DENY');
  });

  it('changes the action hash when any parameter changes', () => {
    expect(hashPolicyAction(base)).not.toBe(
      hashPolicyAction({ ...base, parameters: { path: 'other.ts' } }),
    );
    expect(hashPolicyAction(base)).toBe(
      hashPolicyAction({ ...base, parameters: { path: 'src/index.ts' } }),
    );
  });

  it('audits only structural decision data', async () => {
    const record = vi.fn();
    const engine = new PolicyEngine({ record });
    await engine.evaluate({ ...base, parameters: { canary: 'POLICY-SECRET-CANARY' } });
    expect(JSON.stringify(record.mock.calls)).not.toContain('POLICY-SECRET-CANARY');
  });
});
