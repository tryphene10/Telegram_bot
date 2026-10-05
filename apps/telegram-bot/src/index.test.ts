import { describe, expect, it } from 'vitest';
import { telegramAdapter } from './index.js';

describe('telegram adapter boundary', () => {
  it('has no execution capability', () => {
    expect(telegramAdapter).toMatchObject({ service: 'telegram-bot', executionCapability: false });
  });
});
