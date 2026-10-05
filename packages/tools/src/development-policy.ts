import type { ActionCategory, RiskLevel } from '@arcc/policies';

export interface DevelopmentToolPolicy {
  readonly risk: RiskLevel;
  readonly actionCategory: ActionCategory;
}

const policies: Readonly<Record<string, DevelopmentToolPolicy>> = {
  'git.read': { risk: 'LOW', actionCategory: 'READ' },
  'git.stage': { risk: 'MEDIUM', actionCategory: 'WRITE' },
  'git.branch': { risk: 'MEDIUM', actionCategory: 'WRITE' },
  'git.worktree': { risk: 'MEDIUM', actionCategory: 'WRITE' },
  'git.commit': { risk: 'HIGH', actionCategory: 'GIT_COMMIT' },
  'git.pull': { risk: 'HIGH', actionCategory: 'NETWORK_ACCESS' },
  'git.push': { risk: 'HIGH', actionCategory: 'PUSH' },
  'git.reset': { risk: 'CRITICAL', actionCategory: 'IRREVERSIBLE_DELETE' },
  'docker.read': { risk: 'LOW', actionCategory: 'READ' },
  'docker.build': { risk: 'HIGH', actionCategory: 'CONTAINER_BUILD' },
  'docker.control': { risk: 'MEDIUM', actionCategory: 'CONTAINER_CONTROL' },
  'docker.publish': { risk: 'CRITICAL', actionCategory: 'PUBLICATION' },
};

export function developmentToolPolicy(tool: string): DevelopmentToolPolicy {
  const policy = policies[tool];
  if (!policy) throw new Error('unknown_development_tool');
  return policy;
}
