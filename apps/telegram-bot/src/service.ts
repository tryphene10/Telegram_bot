import type { TelegramAccessController } from './access-control.js';
import { handleFoundationCommand } from './commands.js';
import type { TelegramApiClient, TelegramUpdate } from './telegram-api.js';
import { splitTelegramText } from './delivery.js';
import type { TelegramExperience } from './experience.js';

export class TelegramBotService {
  constructor(
    private readonly api: TelegramApiClient,
    private readonly access: TelegramAccessController,
    private readonly experience?: TelegramExperience,
  ) {}

  async handle(update: TelegramUpdate): Promise<void> {
    const callback = update.callback_query;
    const message = update.message ?? callback?.message;
    const user = update.message?.from ?? callback?.from;
    if (!message || !user) throw new Error('Telegram update denied');

    await this.access.authorize(
      { userId: user.id, chatId: message.chat.id },
      update.update_id,
      callback?.id,
    );

    if (callback) {
      if (this.experience && callback.data) {
        const reply = await this.experience.handleCallback(user.id, callback.data);
        await this.sendReply(message.chat.id, reply.text, reply.buttons);
      }
      await this.api.answerCallbackQuery(callback.id);
      return;
    }
    if (this.experience) {
      const reply = await this.experience.handleText(user.id, message.text ?? '');
      await this.sendReply(message.chat.id, reply.text, reply.buttons);
      return;
    }
    const reply = handleFoundationCommand(message.text ?? '');
    await this.api.sendMessage(message.chat.id, reply.text);
  }

  private async sendReply(
    chatId: number,
    text: string,
    buttons?: readonly { readonly text: string; readonly callbackData: string }[],
  ): Promise<void> {
    const chunks = splitTelegramText(text);
    for (const [index, chunk] of chunks.entries()) {
      await this.api.sendMessage(
        chatId,
        chunk,
        undefined,
        index === chunks.length - 1 ? buttons : undefined,
      );
    }
  }
}
