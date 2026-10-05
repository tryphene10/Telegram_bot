import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { Pool } from 'pg';
import {
  FileVaultStore,
  LocalSecretVault,
  SecretNotFoundError,
  WindowsDpapiKeyProtector,
} from '@arcc/security';
import { LocalOwnerPairing, TelegramAccessController } from './access-control.js';
import { CallbackActionCodec } from './callback-actions.js';
import { TelegramExperience } from './experience.js';
import {
  LocalTelegramPreferenceStore,
  LocalTelegramSecurityAudit,
  LocalTelegramStateStore,
} from './local-state.js';
import { PostgresTelegramOperations } from './postgres-operations.js';
import { TelegramStrongApprovalGate } from './pin-gate.js';
import { TelegramNotificationWorker } from './notification-worker.js';
import { TelegramBotService } from './service.js';
import { pollTelegram, TelegramApiClient, type TelegramUpdate } from './telegram-api.js';

export interface TelegramRuntimeOptions {
  readonly vaultPath: string;
  readonly statePath: string;
  readonly auditPath: string;
  readonly preferencesPath: string;
  readonly databaseUrl: string;
  readonly signal: AbortSignal;
  readonly showLocalPairingCode: (code: string) => void;
}

function pairingIdentity(update: TelegramUpdate) {
  const message = update.message;
  if (!message?.from || !message.text?.startsWith('/pair ')) return null;
  return {
    identity: { userId: message.from.id, chatId: message.chat.id },
    code: message.text.slice('/pair '.length).trim(),
  };
}

async function syncTelegramOwner(
  pool: Pool,
  owner: { readonly userId: number; readonly chatId: number },
): Promise<void> {
  const result = await pool.query(
    `with owner as(
       select id from users where role='OWNER' and status='ACTIVE' order by id limit 1
     )
     insert into telegram_accounts(user_id,telegram_user_id,telegram_chat_id,status,paired_at)
     select id,$1,$2,'ACTIVE',now() from owner
     on conflict(user_id) do update set telegram_user_id=excluded.telegram_user_id,
       telegram_chat_id=excluded.telegram_chat_id,status='ACTIVE',failed_pin_attempts=0,
       locked_until=null,paired_at=now(),revoked_at=null,updated_at=now()`,
    [owner.userId, owner.chatId],
  );
  if (result.rowCount !== 1) throw new Error('telegram_owner_database_sync_failed');
}

export async function runTelegramBot(options: TelegramRuntimeOptions): Promise<void> {
  const vault = await LocalSecretVault.open(
    new FileVaultStore(options.vaultPath),
    new WindowsDpapiKeyProtector(),
  );
  let pool: Pool | undefined;
  const state = new LocalTelegramStateStore(options.statePath);
  const audit = new LocalTelegramSecurityAudit(options.auditPath);
  const access = new TelegramAccessController(state, state, audit);
  const pairing = new LocalOwnerPairing(state);

  try {
    const token = vault.get('telegram-bot-token');
    const pinHash = vault.get('owner-pin-hash');
    let callbackKey: Buffer;
    try {
      callbackKey = Buffer.from(vault.get('telegram-callback-key'), 'base64');
    } catch (error) {
      if (!(error instanceof SecretNotFoundError)) throw error;
      callbackKey = randomBytes(32);
      await vault.set('telegram-callback-key', callbackKey.toString('base64'));
    }
    pool = new Pool({ connectionString: options.databaseUrl, max: 3 });
    await pool.query('select 1');
    const pairedOwner = await state.load();
    if (pairedOwner?.status === 'ACTIVE') await syncTelegramOwner(pool, pairedOwner);
    const api = new TelegramApiClient(token);
    const preferences = new LocalTelegramPreferenceStore(options.preferencesPath);
    const callbacks = new CallbackActionCodec(callbackKey, state);
    const experience = new TelegramExperience(
      preferences,
      new PostgresTelegramOperations(
        pool,
        new TelegramStrongApprovalGate(pinHash, {
          record: async (event) =>
            audit.record({
              event: `telegram.pin.${event.decision.toLowerCase()}`,
              reason: event.reason,
            }),
        }),
        dirname(options.vaultPath),
      ),
      callbacks,
      [token],
    );
    const service = new TelegramBotService(api, access, experience);
    if (!pairedOwner) options.showLocalPairingCode(await pairing.begin(15 * 60 * 1_000));
    const notifications = new TelegramNotificationWorker(
      pool,
      state,
      api,
      `telegram-${process.pid}`,
    );
    await Promise.all([
      pollTelegram(
        api,
        async (update) => {
          const request = pairingIdentity(update);
          if (request && !(await state.load())) {
            const owner = await pairing.claim(request.identity, request.code);
            await syncTelegramOwner(pool!, owner);
            await api.sendMessage(request.identity.chatId, 'Compte Owner appairé.');
            return;
          }
          await service.handle(update);
        },
        options.signal,
        (error) =>
          console.error(
            JSON.stringify({
              event: 'telegram.poll.error',
              error: error instanceof Error ? error.message : 'unknown_error',
            }),
          ),
      ),
      notifications.run(options.signal),
    ]);
  } finally {
    await pool?.end();
    vault.close();
  }
}
