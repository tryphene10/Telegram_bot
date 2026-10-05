import { describe, expect, it, vi } from 'vitest';
import { validateRuntimeCredentials, validateSetupInput } from './configuration.js';

describe('setup input', () => {
  it('forces a six digit PIN and absolute project path', () => {
    expect(() => validateSetupInput({ pin: '1234', localModel: 'local' })).toThrow(
      'pin_must_have_six_digits',
    );
    expect(() =>
      validateSetupInput({ pin: '123456', localModel: 'local', firstProject: 'relative' }),
    ).toThrow('project_path_must_be_absolute');
  });

  it('normalizes only non-secret runtime configuration', () => {
    const result = validateSetupInput({
      pin: '123456',
      telegramToken: ' token ',
      providerKeys: { openai: ' key ' },
      localModel: ' model ',
    });
    expect(result.localModel).toBe('model');
    expect(result.telegramToken).toBe('token');
    expect(result.providerKeys).toEqual({ openai: ' key ' });
  });
});

describe('credential validation', () => {
  it('tests Telegram and provider credentials without returning their contents', async () => {
    const fetcher = vi.fn(async () => ({ ok: true }));
    await expect(
      validateRuntimeCredentials(
        { telegramToken: '123:abcdefghijklmnopqrstuvwxyz', providerKeys: { openai: 'secret-key' } },
        fetcher,
      ),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toContain('/getMe');
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({ authorization: 'Bearer secret-key' });
  });

  it('fails closed when a credential is rejected', async () => {
    await expect(
      validateRuntimeCredentials({ providerKeys: { deepseek: 'invalid' } }, async () => ({
        ok: false,
      })),
    ).rejects.toThrow('deepseek_credential_rejected');
  });
});
