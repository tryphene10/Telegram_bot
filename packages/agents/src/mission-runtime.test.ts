import { describe, expect, it } from 'vitest';
import {
  InMemoryDurableMissionStore,
  normalizeMissionDefinition,
  validateMissionPlan,
  type MissionDefinition,
} from './mission-runtime.js';

const definition: MissionDefinition = {
  idempotencyKey: 'telegram:update:12345',
  projectId: 'project-1',
  objective: '  Build   the feature safely  ',
  context: { source: 'telegram' },
  successCriteria: [' tests pass ', 'tests pass'],
  definitionOfDone: ['objective verified'],
};

describe('mission runtime', () => {
  it('normalizes a complete objective deterministically', () => {
    expect(normalizeMissionDefinition(definition)).toMatchObject({
      objective: 'Build the feature safely',
      successCriteria: ['tests pass'],
    });
  });

  it('deduplicates mission creation and rejects key reuse with other content', () => {
    const store = new InMemoryDurableMissionStore();
    expect(store.create(definition).id).toBe(store.create(definition).id);
    expect(() => store.create({ ...definition, objective: 'Another objective' })).toThrow(
      'mission_idempotency_conflict',
    );
  });

  it('validates dependencies and rejects cycles', () => {
    expect(
      validateMissionPlan([
        {
          id: 'build',
          title: 'Build',
          dependencies: [],
          maxAttempts: 2,
          maxLoops: 2,
          exitCriteria: ['built'],
        },
        {
          id: 'test',
          title: 'Test',
          dependencies: ['build'],
          maxAttempts: 2,
          maxLoops: 2,
          exitCriteria: ['tests pass'],
        },
      ]).map(({ id }) => id),
    ).toEqual(['build', 'test']);
    expect(() =>
      validateMissionPlan([
        {
          id: 'a',
          title: 'A',
          dependencies: ['b'],
          maxAttempts: 1,
          maxLoops: 1,
          exitCriteria: ['a'],
        },
        {
          id: 'b',
          title: 'B',
          dependencies: ['a'],
          maxAttempts: 1,
          maxLoops: 1,
          exitCriteria: ['b'],
        },
      ]),
    ).toThrow('cyclic_step_dependencies');
  });

  it('claims strictly in the order submitted', () => {
    const store = new InMemoryDurableMissionStore();
    const first = store.create(definition);
    store.create({
      ...definition,
      idempotencyKey: 'telegram:update:12346',
      projectId: 'project-2',
    });
    expect(store.claimNext('worker', 1_000)?.id).toBe(first.id);
  });
});
