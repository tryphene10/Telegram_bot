import { describe, expect, it, vi } from 'vitest';
import { InMemoryDurableMissionStore } from './mission-runtime.js';
import { ManifestObjectiveVerifier } from './verification.js';

const mission = new InMemoryDurableMissionStore().create({
  idempotencyKey: 'verify:mission:0001',
  projectId: 'project-1',
  objective: 'Verifier le projet',
  context: {},
  successCriteria: ['checks pass'],
  definitionOfDone: ['evidence exists'],
});

describe('ManifestObjectiveVerifier', () => {
  it('requires objective evidence from declared checks', async () => {
    const runner = {
      run: vi.fn(async () => ({ passed: true, summary: 'ok', evidenceReference: 'log:1' })),
    };
    const verifier = new ManifestObjectiveVerifier(
      { checks: [{ id: 'tests', kind: 'TEST', profile: 'pnpm-test', required: true }] },
      runner,
    );
    await expect(verifier.verify(mission)).resolves.toMatchObject({
      passed: true,
      evidence: ['TEST:tests:log:1'],
      verifiedFacts: ['TEST reussi'],
    });
  });

  it('fails when a required build fails and reports the residual risk', async () => {
    const verifier = new ManifestObjectiveVerifier(
      { checks: [{ id: 'build', kind: 'BUILD', profile: 'pnpm-build', required: true }] },
      { run: vi.fn(async () => ({ passed: false, summary: 'exit 1' })) },
    );
    await expect(verifier.verify(mission)).resolves.toMatchObject({
      passed: false,
      remainingRisks: ['BUILD:build:exit 1'],
    });
  });
});
