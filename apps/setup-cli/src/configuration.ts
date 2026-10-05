import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  FileVaultStore,
  LocalSecretVault,
  WindowsDpapiKeyProtector,
  hashPin,
} from '@arcc/security';

export interface SetupInput {
  readonly pin: string;
  readonly telegramToken?: string;
  readonly providerKeys?: Readonly<Record<string, string>>;
  readonly localModel: string;
  readonly cloudModels?: readonly string[];
  readonly firstProject?: string;
}

export interface SafeRuntimeConfiguration {
  readonly formatVersion: 1;
  readonly autonomy: 'EXECUTE_SAFE';
  readonly apiHost: '127.0.0.1';
  readonly localModel: string;
  readonly cloudModels: readonly string[];
  readonly firstProject?: string;
  readonly configuredAt: string;
}

type CredentialFetch = (
  input: string,
  init: {
    readonly method: 'GET';
    readonly headers?: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  },
) => Promise<{ readonly ok: boolean }>;

export async function validateRuntimeCredentials(
  input: Pick<SetupInput, 'telegramToken' | 'providerKeys'>,
  fetcher: CredentialFetch = globalThis.fetch,
): Promise<void> {
  const checks: Promise<void>[] = [];
  if (input.telegramToken) {
    checks.push(
      (async () => {
        const response = await fetcher(`https://api.telegram.org/bot${input.telegramToken}/getMe`, {
          method: 'GET',
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error('telegram_credential_rejected');
      })(),
    );
  }
  const providers: Readonly<
    Record<
      string,
      { readonly url: string; readonly headers: (key: string) => Record<string, string> }
    >
  > = {
    openai: {
      url: 'https://api.openai.com/v1/models',
      headers: (key) => ({ authorization: `Bearer ${key}` }),
    },
    anthropic: {
      url: 'https://api.anthropic.com/v1/models',
      headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    },
    deepseek: {
      url: 'https://api.deepseek.com/models',
      headers: (key) => ({ authorization: `Bearer ${key}` }),
    },
    moonshot: {
      url: 'https://api.moonshot.ai/v1/models',
      headers: (key) => ({ authorization: `Bearer ${key}` }),
    },
  };
  for (const [rawProvider, rawKey] of Object.entries(input.providerKeys ?? {})) {
    const provider = providers[rawProvider.toLowerCase()];
    const key = rawKey.trim();
    if (!provider || !key) throw new Error('unsupported_or_empty_provider_credential');
    checks.push(
      (async () => {
        const response = await fetcher(provider.url, {
          method: 'GET',
          headers: provider.headers(key),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`${rawProvider.toLowerCase()}_credential_rejected`);
      })(),
    );
  }
  await Promise.all(checks);
}

export function validateSetupInput(value: unknown): SetupInput {
  if (!value || typeof value !== 'object') throw new Error('setup_input_required');
  const input = value as Partial<SetupInput>;
  if (!/^\d{6}$/u.test(input.pin ?? '')) throw new Error('pin_must_have_six_digits');
  if (!input.localModel?.trim()) throw new Error('local_model_required');
  if (input.firstProject && !isAbsolute(input.firstProject)) {
    throw new Error('project_path_must_be_absolute');
  }
  return {
    pin: input.pin ?? '',
    localModel: input.localModel.trim(),
    ...(input.telegramToken?.trim() ? { telegramToken: input.telegramToken.trim() } : {}),
    ...(input.providerKeys ? { providerKeys: input.providerKeys } : {}),
    ...(input.cloudModels ? { cloudModels: input.cloudModels.map((model) => model.trim()) } : {}),
    ...(input.firstProject ? { firstProject: resolve(input.firstProject) } : {}),
  };
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

export async function configureLocalRuntime(
  dataDirectory: string,
  rawInput: unknown,
  now: () => Date = () => new Date(),
) {
  if (process.platform !== 'win32') throw new Error('windows_required');
  const input = validateSetupInput(rawInput);
  await validateRuntimeCredentials(input);
  const vault = await LocalSecretVault.open(
    new FileVaultStore(resolve(dataDirectory, 'vault.json')),
    new WindowsDpapiKeyProtector(),
  );
  try {
    await vault.set('owner-pin-hash', await hashPin(input.pin));
    if (input.telegramToken) await vault.set('telegram-bot-token', input.telegramToken);
    for (const [provider, key] of Object.entries(input.providerKeys ?? {})) {
      if (key.trim()) await vault.set(`provider-${provider.toLowerCase()}`, key.trim());
    }
  } finally {
    vault.close();
  }
  const configuration: SafeRuntimeConfiguration = {
    formatVersion: 1,
    autonomy: 'EXECUTE_SAFE',
    apiHost: '127.0.0.1',
    localModel: input.localModel,
    cloudModels: input.cloudModels ?? [],
    ...(input.firstProject ? { firstProject: input.firstProject } : {}),
    configuredAt: now().toISOString(),
  };
  await atomicJson(resolve(dataDirectory, 'config.json'), configuration);
  return configuration;
}
