import { describe, expect, it } from 'vitest';
import { developmentToolPolicy } from './development-policy.js';

describe('development tool policies', () => {
  it.each([
    ['git.commit', 'GIT_COMMIT'],
    ['git.pull', 'NETWORK_ACCESS'],
    ['git.push', 'PUSH'],
    ['git.reset', 'IRREVERSIBLE_DELETE'],
    ['docker.build', 'CONTAINER_BUILD'],
    ['docker.publish', 'PUBLICATION'],
  ] as const)('maps %s to a separate policy action', (tool, actionCategory) => {
    expect(developmentToolPolicy(tool).actionCategory).toBe(actionCategory);
  });

  it('fails closed for an unknown development tool', () => {
    expect(() => developmentToolPolicy('git.arbitrary')).toThrow('unknown_development_tool');
  });
});
