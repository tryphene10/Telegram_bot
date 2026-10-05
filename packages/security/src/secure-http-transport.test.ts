import { describe, expect, it, vi } from 'vitest';
import { AllowlistedJsonHttpTransport } from './secure-http-transport.js';

describe('AllowlistedJsonHttpTransport', () => {
  it('injects credentials only after an exact HTTPS endpoint match', async () => {
    const fetcher = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));
    const transport = new AllowlistedJsonHttpTransport(
      { OPENAI: ['https://api.openai.com/v1/responses'] },
      { resolve: vi.fn(async () => 'API-SECRET-CANARY') },
      fetcher,
    );
    await transport.send({
      destination: 'OPENAI',
      url: 'https://api.openai.com/v1/responses',
      credentialKey: 'OPENAI_API_KEY',
      headers: { 'content-type': 'application/json' },
      body: { model: 'requested' },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer API-SECRET-CANARY' }),
      }),
    );
  });

  it('rejects endpoint substitution before resolving a secret or sending', async () => {
    const resolve = vi.fn(async () => 'secret');
    const fetcher = vi.fn();
    const transport = new AllowlistedJsonHttpTransport(
      { OPENAI: ['https://api.openai.com/v1/responses'] },
      { resolve },
      fetcher,
    );
    await expect(
      transport.send({
        destination: 'OPENAI',
        url: 'https://attacker.example/v1/responses',
        credentialKey: 'OPENAI_API_KEY',
        headers: {},
        body: {},
      }),
    ).rejects.toThrow('endpoint_not_allowlisted');
    expect(resolve).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('allows a credential-free local runtime only on loopback HTTP', async () => {
    const fetcher = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));
    const transport = new AllowlistedJsonHttpTransport(
      { LOCAL_MODEL: ['http://127.0.0.1:11434/api/chat'] },
      { resolve: vi.fn() },
      fetcher,
    );
    await expect(
      transport.send({
        destination: 'LOCAL_MODEL',
        url: 'http://127.0.0.1:11434/api/chat',
        headers: {},
        body: {},
      }),
    ).resolves.toMatchObject({ status: 200 });
  });
});
