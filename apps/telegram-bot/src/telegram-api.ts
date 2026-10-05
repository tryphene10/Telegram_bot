export interface TelegramUser {
  readonly id: number;
}

export interface TelegramChat {
  readonly id: number;
}

export interface TelegramMessage {
  readonly message_id: number;
  readonly from?: TelegramUser;
  readonly chat: TelegramChat;
  readonly text?: string;
}

export interface TelegramCallbackQuery {
  readonly id: string;
  readonly from: TelegramUser;
  readonly message?: TelegramMessage;
  readonly data?: string;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly callback_query?: TelegramCallbackQuery;
}

interface TelegramEnvelope<T> {
  readonly ok: boolean;
  readonly result?: T;
}

export class TelegramApiClient {
  private readonly baseUrl: string;

  constructor(token: string) {
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/u.test(token)) {
      throw new Error('Telegram bot token is invalid');
    }
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async getUpdates(
    offset: number,
    signal?: AbortSignal,
    timeoutSeconds = 25,
  ): Promise<readonly TelegramUpdate[]> {
    return this.call<readonly TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSeconds, allowed_updates: ['message', 'callback_query'] },
      signal,
    );
  }

  async sendMessage(
    chatId: number,
    text: string,
    signal?: AbortSignal,
    buttons?: readonly { readonly text: string; readonly callbackData: string }[],
  ): Promise<void> {
    await this.call(
      'sendMessage',
      {
        chat_id: chatId,
        text,
        ...(buttons?.length
          ? {
              reply_markup: {
                inline_keyboard: [
                  buttons.map((button) => ({
                    text: button.text,
                    callback_data: button.callbackData,
                  })),
                ],
              },
            }
          : {}),
      },
      signal,
    );
  }

  async answerCallbackQuery(callbackQueryId: string, signal?: AbortSignal): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackQueryId }, signal);
  }

  private async call<T>(
    method: string,
    body: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal ?? null,
      });
    } catch {
      throw new Error('Telegram API request failed');
    }
    if (!response.ok) throw new Error('Telegram API rejected the request');
    const envelope = (await response.json()) as TelegramEnvelope<T>;
    if (!envelope.ok || envelope.result === undefined) {
      throw new Error('Telegram API returned an invalid response');
    }
    return envelope.result;
  }
}

export async function pollTelegram(
  client: TelegramApiClient,
  handle: (update: TelegramUpdate) => Promise<void>,
  signal: AbortSignal,
  onError: (error: unknown) => void = () => undefined,
  retryDelayMs = 1_000,
): Promise<void> {
  let offset = 0;
  while (!signal.aborted) {
    let updates: readonly TelegramUpdate[];
    try {
      updates = await client.getUpdates(offset, signal);
    } catch (error) {
      if (signal.aborted) break;
      onError(error);
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    for (const update of updates) {
      try {
        await handle(update);
      } catch (error) {
        onError(error);
      } finally {
        offset = Math.max(offset, update.update_id + 1);
      }
    }
  }
}
