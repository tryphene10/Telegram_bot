import { describe, expect, it } from 'vitest';
import { handleFoundationCommand, parseTelegramCommand, TELEGRAM_COMMANDS } from './commands.js';

describe('foundation commands', () => {
  it.each(['/start', '/help', '/settings', '/diagnostic'])('handles %s', (command) => {
    expect(handleFoundationCommand(command).command).not.toBe('unknown');
  });

  it('does not expose an execution command', () => {
    expect(handleFoundationCommand('/execute whoami').command).toBe('unknown');
  });

  it.each(TELEGRAM_COMMANDS)('parses /%s as an operational command', (command) => {
    expect(parseTelegramCommand(`/${command} value`)).toMatchObject({
      kind: 'OPERATIONAL',
      command,
    });
  });

  it('turns natural language into a task without interpreting it as a shell command', () => {
    expect(parseTelegramCommand('Corrige le bug du calcul')).toEqual({
      kind: 'TASK',
      objective: 'Corrige le bug du calcul',
    });
  });
});
