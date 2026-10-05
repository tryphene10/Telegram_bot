import type { PolicyResult, RiskLevel } from '@arcc/policies';
import type { AutonomyLevel, ExecutionAuthorization } from './types.js';

export function authorizeAutonomy(
  level: AutonomyLevel,
  risk: RiskLevel,
  policy: PolicyResult,
): ExecutionAuthorization {
  const details = { actionHash: policy.actionHash, policyDecision: policy.decision } as const;
  if (policy.decision === 'DENY') return { outcome: 'DENY', reason: policy.reason, ...details };
  if (level === 'OBSERVE') return { outcome: 'OBSERVE', reason: 'autonomy_observe', ...details };
  if (level === 'ASSIST') return { outcome: 'PROPOSE', reason: 'autonomy_assist', ...details };
  if (policy.decision === 'REQUIRE_APPROVAL' || policy.decision === 'REQUIRE_STRONG_APPROVAL')
    return { outcome: 'WAIT_APPROVAL', reason: policy.reason, ...details };
  if (level === 'EXECUTE_SAFE' && risk !== 'LOW')
    return { outcome: 'WAIT_APPROVAL', reason: 'execute_safe_low_only', ...details };
  return { outcome: 'EXECUTE', reason: 'policy_allowed', ...details };
}
