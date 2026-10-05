export interface AlertState {
  readonly incidentId: string;
  readonly severity: 'INFO' | 'WARNING' | 'ERROR' | 'SECURITY';
  readonly lastSentAt?: number;
  readonly lastFingerprint?: string;
  readonly groupedCount: number;
}
export interface AlertDecision {
  readonly send: boolean;
  readonly groupedCount: number;
  readonly reason:
    'NEW' | 'AGGRAVATED' | 'SECURITY' | 'WINDOW_ELAPSED' | 'GROUPED' | 'BUDGET_EXHAUSTED';
}
export function decideAlert(input: {
  readonly state: AlertState;
  readonly fingerprint: string;
  readonly now: number;
  readonly groupingWindowMs: number;
  readonly dailySent: number;
  readonly dailyBudget: number;
  readonly aggravated?: boolean;
}): AlertDecision {
  if (input.state.severity === 'SECURITY')
    return { send: true, groupedCount: 0, reason: 'SECURITY' };
  if (input.dailySent >= input.dailyBudget)
    return { send: false, groupedCount: input.state.groupedCount + 1, reason: 'BUDGET_EXHAUSTED' };
  if (!input.state.lastSentAt) return { send: true, groupedCount: 0, reason: 'NEW' };
  if (input.aggravated || input.state.lastFingerprint !== input.fingerprint)
    return { send: true, groupedCount: 0, reason: 'AGGRAVATED' };
  if (input.now - input.state.lastSentAt >= input.groupingWindowMs)
    return { send: true, groupedCount: 0, reason: 'WINDOW_ELAPSED' };
  return { send: false, groupedCount: input.state.groupedCount + 1, reason: 'GROUPED' };
}
