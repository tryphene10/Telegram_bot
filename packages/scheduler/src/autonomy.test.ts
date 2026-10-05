import { describe, expect, it } from 'vitest';
import type { PolicyDecision, RiskLevel } from '@arcc/policies';
import { authorizeAutonomy } from './autonomy.js';

describe('autonomy matrix', () => {
  const levels = ['OBSERVE', 'ASSIST', 'EXECUTE_SAFE', 'AUTONOMOUS'] as const;
  const risks = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
  const decision = (risk: RiskLevel): PolicyDecision =>
    risk === 'LOW' ? 'ALLOW' : risk === 'MEDIUM' ? 'REQUIRE_APPROVAL' : 'REQUIRE_STRONG_APPROVAL';
  for (const level of levels)
    for (const risk of risks)
      it(`${level} / ${risk}`, () => {
        const result = authorizeAutonomy(level, risk, {
          decision: decision(risk),
          reason: `risk_${risk}`,
          explanation: '',
          actionHash: `${level}-${risk}`,
        });
        if (level === 'OBSERVE') expect(result.outcome).toBe('OBSERVE');
        else if (level === 'ASSIST') expect(result.outcome).toBe('PROPOSE');
        else if (risk === 'LOW') expect(result.outcome).toBe('EXECUTE');
        else expect(result.outcome).toBe('WAIT_APPROVAL');
      });
  it('never overrides a policy denial', () => {
    expect(
      authorizeAutonomy('AUTONOMOUS', 'LOW', {
        decision: 'DENY',
        reason: 'blocked',
        explanation: '',
        actionHash: 'x',
      }).outcome,
    ).toBe('DENY');
  });
});
