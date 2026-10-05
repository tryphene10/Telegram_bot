import { describe, expect, it, vi } from 'vitest';
import { classifyContent, markCloudSafeUserInstruction } from './classification.js';
import {
  EgressDeniedError,
  EgressGateway,
  type EgressAuditSink,
  type EgressDispatcher,
} from './egress-gateway.js';
import { SecretRedactor } from './redaction.js';

function createGateway() {
  const dispatch = vi.fn().mockResolvedValue({ body: 'ok' });
  const record = vi.fn().mockResolvedValue(undefined);
  return {
    gateway: new EgressGateway(
      ['LOCAL_MODEL', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'MOONSHOT'],
      { dispatch } as EgressDispatcher,
      { record } as EgressAuditSink,
      new SecretRedactor(['EGRESS-CANARY-SECRET']),
    ),
    dispatch,
    record,
  };
}

describe('EgressGateway', () => {
  it.each([
    'CODE',
    'DIFF',
    'FILE_CONTENT',
    'TERMINAL_LOG',
    'SCREENSHOT',
    'PROJECT_MEMORY',
  ] as const)('never sends %s to a cloud model', async (kind) => {
    const { gateway, dispatch } = createGateway();
    await expect(
      gateway.send({
        destination: 'OPENAI',
        model: 'requested-model',
        correlationId: 'correlation-id',
        payload: classifyContent(kind, 'LOCAL-CONTENT-CANARY'),
      }),
    ).rejects.toBeInstanceOf(EgressDeniedError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('honours the explicitly selected cloud provider and model', async () => {
    const { gateway, dispatch } = createGateway();
    await gateway.send({
      destination: 'ANTHROPIC',
      model: 'claude-requested',
      correlationId: 'correlation-id',
      payload: markCloudSafeUserInstruction('Explain a public concept'),
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'ANTHROPIC', model: 'claude-requested' }),
    );
  });

  it('blocks a canary even when metadata claims cloud-safe', async () => {
    const { gateway, dispatch, record } = createGateway();
    await expect(
      gateway.send({
        destination: 'DEEPSEEK',
        model: 'deepseek-requested',
        correlationId: 'correlation-id',
        payload: markCloudSafeUserInstruction('EGRESS-CANARY-SECRET'),
      }),
    ).rejects.toThrow('secret_content_forbidden');
    expect(dispatch).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'DENIED', contentBytes: 20 }),
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain('EGRESS-CANARY-SECRET');
  });

  it('permits local-only content only for the selected local model', async () => {
    const { gateway, dispatch } = createGateway();
    await gateway.send({
      destination: 'LOCAL_MODEL',
      model: 'local-requested',
      correlationId: 'correlation-id',
      payload: classifyContent('CODE', 'const local = true;'),
    });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('fails closed for destinations outside the runtime allowlist', async () => {
    const { dispatch } = createGateway();
    const restricted = new EgressGateway(
      ['LOCAL_MODEL'],
      { dispatch } as EgressDispatcher,
      { record: vi.fn() } as unknown as EgressAuditSink,
    );
    await expect(
      restricted.send({
        destination: 'MOONSHOT',
        model: 'kimi-requested',
        correlationId: 'correlation-id',
        payload: markCloudSafeUserInstruction('hello'),
      }),
    ).rejects.toThrow('destination_not_allowlisted');
  });
});
