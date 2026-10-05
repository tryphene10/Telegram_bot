import type { Pool } from 'pg';
import type { OwnerAccountStore } from './access-control.js';

export interface TelegramNotificationSender {
  sendMessage(chatId: number, text: string, signal?: AbortSignal): Promise<void>;
}

interface NotificationRow {
  readonly public_id: string;
  readonly payload_sanitized: Record<string, unknown>;
}

function notificationText(payload: Readonly<Record<string, unknown>>): string {
  for (const key of ['text', 'message', 'summary', 'title']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 4_000);
  }
  return 'ARCC : une nouvelle notification est disponible dans le dashboard.';
}

export class TelegramNotificationWorker {
  constructor(
    private readonly pool: Pool,
    private readonly owners: OwnerAccountStore,
    private readonly sender: TelegramNotificationSender,
    private readonly workerId: string,
    private readonly intervalMs = 1_000,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        if (!(await this.runOnce(signal))) await this.wait(signal);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'telegram.notification.error',
            error: error instanceof Error ? error.message : 'unknown',
          }),
        );
        await this.wait(signal);
      }
    }
  }

  async runOnce(signal?: AbortSignal): Promise<boolean> {
    const owner = await this.owners.load();
    if (!owner || owner.status !== 'ACTIVE') return false;
    const claimed = await this.pool.query<NotificationRow>(
      `with candidate as (
         select id from notifications
         where channel='TELEGRAM' and level<>'SILENT' and status='PENDING'
           and scheduled_at<=now() and (lease_expires_at is null or lease_expires_at<now())
         order by scheduled_at,id for update skip locked limit 1
       )
       update notifications n set lease_owner=$1,lease_expires_at=now()+interval '60 seconds',attempts=attempts+1
       from candidate where n.id=candidate.id
       returning n.public_id,n.payload_sanitized`,
      [this.workerId],
    );
    const item = claimed.rows[0];
    if (!item) return false;
    try {
      await this.sender.sendMessage(owner.chatId, notificationText(item.payload_sanitized), signal);
      await this.pool.query(
        `update notifications set status='SENT',sent_at=now(),lease_owner=null,lease_expires_at=null
         where public_id=$1::uuid and lease_owner=$2 and status='PENDING'`,
        [item.public_id, this.workerId],
      );
      return true;
    } catch (error) {
      await this.pool.query(
        `update notifications set status=case when attempts>=5 then 'FAILED' else 'PENDING' end,
           scheduled_at=case when attempts>=5 then scheduled_at else now()+make_interval(secs=>least(300,power(2,attempts)::int)) end,
           lease_owner=null,lease_expires_at=null
         where public_id=$1::uuid and lease_owner=$2 and status='PENDING'`,
        [item.public_id, this.workerId],
      );
      throw error;
    }
  }

  private async wait(signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.intervalMs);
      timer.unref?.();
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
