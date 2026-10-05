import { describe, expect, it, vi } from 'vitest';
import { CallbackActionCodec } from './callback-actions.js';
import { InMemoryTelegramPreferenceStore, TelegramExperience } from './experience.js';

function experience() {
  const replay = new Set<string>();
  const callbacks = new CallbackActionCodec(Buffer.alloc(32, 4), {
    claim: async (id) => !replay.has(id) && Boolean(replay.add(id)),
  });
  const store = new InMemoryTelegramPreferenceStore();
  const operations = {
    validateSelection: vi.fn(async () => true),
    invoke: vi.fn(
      async (input: { command: string; model?: { provider: string; model: string } }) => ({
        text: input.command === 'task' ? 'Mission creee. token=hidden' : 'Etat controle.',
        classification: 'LOCAL_ONLY' as const,
        telegramAuthorized: true,
        ...(input.model ? { usedModel: input.model } : {}),
        targetReference: 'mission1',
        stateReference: 'rev1',
        actions: ['DETAILS', 'DIFF', 'COMMIT', 'PUSH', 'DEPLOY'] as const,
      }),
    ),
  };
  return { store, operations, runtime: new TelegramExperience(store, operations, callbacks) };
}

describe('TelegramExperience', () => {
  it('requires context then confirms and uses the exact requested model', async () => {
    const values = experience();
    await expect(values.runtime.handleText(1, 'Corrige le projet')).resolves.toMatchObject({
      text: expect.stringContaining('projet, machine, modele'),
    });
    await values.runtime.handleText(1, '/project project-1');
    await values.runtime.handleText(1, '/machine machine-1');
    const confirmation = await values.runtime.handleText(1, '/model claude:claude-explicit');
    expect(confirmation.buttons).toHaveLength(1);
    await values.runtime.handleCallback(1, confirmation.buttons?.[0]?.callbackData ?? '');
    const result = await values.runtime.handleText(1, 'Corrige le projet');
    expect(result.text).toContain('Mission creee');
    expect(result.text).not.toContain('hidden');
    expect(values.operations.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'task',
        model: { provider: 'ANTHROPIC', model: 'claude-explicit' },
      }),
    );
  });

  it('refuses a backend model mismatch and unauthorized Telegram output', async () => {
    const values = experience();
    await values.store.save(1, {
      project: 'p',
      machine: 'm',
      model: { provider: 'LOCAL', model: 'local-a' },
      notificationLevel: 'NORMAL',
    });
    values.operations.invoke.mockResolvedValueOnce({
      text: 'x',
      classification: 'LOCAL_ONLY',
      telegramAuthorized: true,
      usedModel: { provider: 'OPENAI', model: 'gpt' },
      targetReference: 'x',
      stateReference: 'rev1',
      actions: [],
    });
    await expect(values.runtime.handleText(1, '/task test')).rejects.toThrow(
      'model_selection_mismatch',
    );
    values.operations.invoke.mockResolvedValueOnce({
      text: 'x',
      classification: 'LOCAL_ONLY',
      telegramAuthorized: false,
      targetReference: 'x',
      stateReference: 'rev1',
      actions: [],
    });
    await expect(values.runtime.handleText(1, '/status')).rejects.toThrow(
      'telegram_output_not_authorized',
    );
  });

  it('routes phase 15B callbacks to their exact command with bound state', async () => {
    const values = experience();
    values.operations.invoke.mockResolvedValueOnce({
      text: 'Plan pret.',
      classification: 'LOCAL_ONLY',
      telegramAuthorized: true,
      targetReference: 'mission2',
      stateReference: 'rev4',
      actions: ['TAKEOVER'] as const,
    });
    const reply = await values.runtime.handleText(1, '/plan mission2');
    await values.runtime.handleCallback(1, reply.buttons?.[0]?.callbackData ?? '');
    expect(values.operations.invoke).toHaveBeenLastCalledWith({
      command: 'takeover',
      argument: 'TAKEOVER:mission2:rev4',
    });
  });

  it('routes irreversible knowledge purge through a state-bound callback', async () => {
    const values = experience();
    values.operations.invoke.mockResolvedValueOnce({
      text: 'Confirmer la purge forte.',
      classification: 'LOCAL_ONLY',
      telegramAuthorized: true,
      targetReference: 'project1',
      stateReference: 'purge1',
      actions: ['PURGE_MEMORY'] as const,
    });
    const reply = await values.runtime.handleText(1, '/forget project1');
    await values.runtime.handleCallback(1, reply.buttons?.[0]?.callbackData ?? '');
    expect(values.operations.invoke).toHaveBeenLastCalledWith({
      command: 'forget',
      argument: 'PURGE_MEMORY:project1:purge1',
    });
  });

  it('routes signed one-use incident actions with their exact incident state', async () => {
    const values = experience();
    values.operations.invoke.mockResolvedValueOnce({
      text: 'Incident ouvert.',
      classification: 'LOCAL_ONLY',
      telegramAuthorized: true,
      targetReference: 'incident1',
      stateReference: 'hash1',
      actions: ['INVESTIGATE', 'RESTART', 'IGNORE'] as const,
    });
    const reply = await values.runtime.handleText(1, '/incidents');
    await values.runtime.handleCallback(1, reply.buttons?.[1]?.callbackData ?? '');
    expect(values.operations.invoke).toHaveBeenLastCalledWith({
      command: 'incident',
      argument: 'RESTART:incident1:hash1',
    });
  });
});
