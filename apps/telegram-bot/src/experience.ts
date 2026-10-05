import { randomBytes } from 'node:crypto';
import type { ModelChoice } from '@arcc/ai';
import { SecretRedactor } from '@arcc/security';
import type { DataClassification } from '@arcc/security';
import type { CallbackAction, CallbackActionCodec } from './callback-actions.js';
import { parseTelegramCommand, type OperationalCommand } from './commands.js';

export interface TelegramPreferences {
  readonly project?: string;
  readonly machine?: string;
  readonly model?: ModelChoice;
  readonly notificationLevel: 'SILENT' | 'NORMAL' | 'VERBOSE';
}

export interface TelegramPreferenceStore {
  load(userId: number): Promise<TelegramPreferences>;
  save(userId: number, preferences: TelegramPreferences): Promise<void>;
  putPendingModel(
    reference: string,
    userId: number,
    model: ModelChoice,
    expiresAt: number,
  ): Promise<void>;
  takePendingModel(reference: string, userId: number): Promise<ModelChoice | null>;
}

export class InMemoryTelegramPreferenceStore implements TelegramPreferenceStore {
  private readonly preferences = new Map<number, TelegramPreferences>();
  private readonly pending = new Map<
    string,
    { userId: number; model: ModelChoice; expiresAt: number }
  >();
  constructor(private readonly now: () => number = Date.now) {}
  async load(userId: number): Promise<TelegramPreferences> {
    return this.preferences.get(userId) ?? { notificationLevel: 'NORMAL' };
  }
  async save(userId: number, preferences: TelegramPreferences): Promise<void> {
    this.preferences.set(userId, preferences);
  }
  async putPendingModel(
    reference: string,
    userId: number,
    model: ModelChoice,
    expiresAt: number,
  ): Promise<void> {
    this.pending.set(reference, { userId, model, expiresAt });
  }
  async takePendingModel(reference: string, userId: number): Promise<ModelChoice | null> {
    const value = this.pending.get(reference);
    this.pending.delete(reference);
    return value && value.userId === userId && value.expiresAt > this.now() ? value.model : null;
  }
}

export interface TelegramOperationPort {
  invoke(input: {
    readonly command: Exclude<OperationalCommand, 'model' | 'project' | 'machine'> | 'task';
    readonly argument?: string;
    readonly objective?: string;
    readonly project?: string;
    readonly machine?: string;
    readonly model?: ModelChoice;
  }): Promise<{
    readonly text: string;
    readonly classification: DataClassification;
    readonly telegramAuthorized: boolean;
    readonly usedModel?: ModelChoice;
    readonly targetReference?: string;
    readonly stateReference?: string;
    readonly actions?: readonly CallbackAction[];
  }>;
  validateSelection(input: {
    readonly kind: 'PROJECT' | 'MACHINE' | 'MODEL';
    readonly value: string;
  }): Promise<boolean>;
}

export interface TelegramExperienceReply {
  readonly text: string;
  readonly buttons?: readonly { readonly text: string; readonly callbackData: string }[];
}

const providerAliases: Readonly<Record<string, ModelChoice['provider']>> = {
  openai: 'OPENAI',
  gpt: 'OPENAI',
  anthropic: 'ANTHROPIC',
  claude: 'ANTHROPIC',
  deepseek: 'DEEPSEEK',
  kimi: 'MOONSHOT',
  moonshot: 'MOONSHOT',
  local: 'LOCAL',
  ollama: 'LOCAL',
};

function parseModel(value: string): ModelChoice {
  const [rawProvider, ...modelParts] = value.trim().split(/[:/]/u);
  const provider = providerAliases[rawProvider?.toLowerCase() ?? ''];
  const model = modelParts.join(':').trim();
  if (!provider || !model) throw new Error('Modele attendu : fournisseur:identifiant');
  return { provider, model };
}

function sameModel(left: ModelChoice | undefined, right: ModelChoice): boolean {
  return left?.provider === right.provider && left.model === right.model;
}

export class TelegramExperience {
  private readonly redactor: SecretRedactor;
  constructor(
    private readonly store: TelegramPreferenceStore,
    private readonly operations: TelegramOperationPort,
    private readonly callbacks: CallbackActionCodec,
    secretCanaries: readonly string[] = [],
    private readonly now: () => number = Date.now,
  ) {
    this.redactor = new SecretRedactor(secretCanaries);
  }

  async handleText(userId: number, text: string): Promise<TelegramExperienceReply> {
    const parsed = parseTelegramCommand(text);
    if (parsed.kind === 'FOUNDATION') {
      return {
        text:
          parsed.command === 'help'
            ? 'Utilisez /task, /status, /projects, /machines, /models ou /approvals.'
            : `Commande /${parsed.command} disponible.`,
      };
    }
    if (parsed.kind === 'UNKNOWN') return { text: 'Commande inconnue. Utilisez /help.' };
    const preferences = await this.store.load(userId);
    if (parsed.kind === 'TASK') return this.task(parsed.objective, preferences);
    if (parsed.command === 'task') {
      if (!parsed.argument) return { text: 'Objectif requis apres /task.' };
      return this.task(parsed.argument, preferences);
    }
    if (parsed.command === 'project' || parsed.command === 'machine') {
      if (!parsed.argument) return { text: `Identifiant requis apres /${parsed.command}.` };
      const valid = await this.operations.validateSelection({
        kind: parsed.command.toUpperCase() as 'PROJECT' | 'MACHINE',
        value: parsed.argument,
      });
      if (!valid) return { text: `${parsed.command} inconnu ou indisponible.` };
      await this.store.save(userId, { ...preferences, [parsed.command]: parsed.argument });
      return { text: `${parsed.command} actif : ${parsed.argument}.` };
    }
    if (parsed.command === 'model') {
      if (!parsed.argument)
        return {
          text: preferences.model
            ? `Modele actif : ${preferences.model.provider}/${preferences.model.model}.`
            : 'Aucun modele actif.',
        };
      const model = parseModel(parsed.argument);
      if (
        !(await this.operations.validateSelection({
          kind: 'MODEL',
          value: `${model.provider}:${model.model}`,
        }))
      )
        return { text: 'Modele inconnu, desactive ou indisponible.' };
      if (sameModel(preferences.model, model))
        return { text: `Modele deja actif : ${model.provider}/${model.model}.` };
      const reference = randomBytes(6).toString('base64url');
      const expiresAt = this.now() + 10 * 60_000;
      await this.store.putPendingModel(reference, userId, model, expiresAt);
      return {
        text: `Confirmer le changement vers ${model.provider}/${model.model}.`,
        buttons: [
          {
            text: 'Confirmer le modele',
            callbackData: this.callbacks.issue('MODEL', reference, 10 * 60_000, 'pending'),
          },
        ],
      };
    }
    const result = await this.operations.invoke({
      command: parsed.command,
      ...(parsed.argument ? { argument: parsed.argument } : {}),
      ...preferences,
    });
    return this.reply(result);
  }

  async handleCallback(userId: number, data: string): Promise<TelegramExperienceReply> {
    const callback = await this.callbacks.consume(data);
    if (callback.action === 'MODEL') {
      const model = await this.store.takePendingModel(callback.target, userId);
      if (!model) return { text: 'Changement de modele expire ou deja utilise.' };
      const current = await this.store.load(userId);
      await this.store.save(userId, { ...current, model });
      return { text: `Modele actif : ${model.provider}/${model.model}.` };
    }
    const commands: Readonly<
      Partial<Record<CallbackAction, Exclude<OperationalCommand, 'model' | 'project' | 'machine'>>>
    > = {
      PLAN: 'plan',
      TAKEOVER: 'takeover',
      CONTINUE: 'continue',
      RETRY: 'retry',
      PROOF: 'proof',
      QUEUE: 'queue',
      DRYRUN: 'dryrun',
      PURGE_MEMORY: 'forget',
      INVESTIGATE: 'incident',
      RESTART: 'incident',
      IGNORE: 'incident',
    };
    const result = await this.operations.invoke({
      command: commands[callback.action] ?? 'status',
      argument: `${callback.action}:${callback.target}:${callback.stateTag}`,
    });
    return this.reply(result);
  }

  private async task(
    objective: string,
    preferences: TelegramPreferences,
  ): Promise<TelegramExperienceReply> {
    const missing = [
      !preferences.project && 'projet',
      !preferences.machine && 'machine',
      !preferences.model && 'modele',
    ].filter(Boolean);
    if (missing.length)
      return { text: `Selection requise avant la mission : ${missing.join(', ')}.` };
    const result = await this.operations.invoke({ command: 'task', objective, ...preferences });
    if (!result.usedModel || !sameModel(result.usedModel, preferences.model as ModelChoice))
      throw new Error('model_selection_mismatch');
    return this.reply(result);
  }

  private reply(
    result: Awaited<ReturnType<TelegramOperationPort['invoke']>>,
  ): TelegramExperienceReply {
    if (!result.telegramAuthorized) throw new Error('telegram_output_not_authorized');
    if (result.classification === 'SECRET') throw new Error('secret_telegram_output_forbidden');
    const text = this.redactor.redact(result.text).text;
    if (!result.targetReference || !result.actions?.length) return { text };
    if (!result.stateReference) throw new Error('callback_state_reference_required');
    return {
      text,
      buttons: result.actions.map((action) => ({
        text: action,
        callbackData: this.callbacks.issue(
          action,
          result.targetReference as string,
          10 * 60_000,
          result.stateReference as string,
        ),
      })),
    };
  }
}
