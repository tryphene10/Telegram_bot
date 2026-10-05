import { describe, expect, it, vi } from 'vitest';
import { SqlModelRunAuditSink } from './model-run-audit.js';
import type { SqlClient } from './sql.js';

describe('SqlModelRunAuditSink', () => {
  it('persists exact provider/model metrics without prompt or response content', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    await new SqlModelRunAuditSink({ query } as SqlClient).record({
      correlationId: '11111111-1111-4111-8111-111111111111',
      missionId: '22222222-2222-4222-8222-222222222222',
      agentKey: 'planner',
      provider: 'OPENAI',
      requestedModel: 'gpt-requested',
      returnedModel: 'gpt-requested',
      classification: 'CLOUD_SAFE',
      status: 'COMPLETED',
      latencyMs: 120,
      inputTokens: 10,
      outputTokens: 5,
      estimatedCostMicrounits: 2,
      reason: 'selected_model_completed',
    });
    const serialized = JSON.stringify(query.mock.calls);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(serialized).toContain('gpt-requested');
    expect(serialized).toContain('MODEL_RUN');
    expect(sql).toContain('$8::bigint');
    expect(serialized).not.toContain('prompt');
    expect(serialized).not.toContain('response content');
  });
});
