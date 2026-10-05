import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  OwnerAccount,
  OwnerAccountStore,
  ReplayStore,
  TelegramSecurityAudit,
} from './access-control.js';
import type { ModelChoice } from '@arcc/ai';
import type { TelegramPreferenceStore, TelegramPreferences } from './experience.js';

interface TelegramState {
  readonly owner: OwnerAccount | null;
  readonly replayExpirations: Readonly<Record<string, number>>;
}

export class LocalTelegramStateStore implements OwnerAccountStore, ReplayStore {
  private statePromise: Promise<TelegramState> | null = null;
  private mutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<OwnerAccount | null> {
    return (await this.state()).owner;
  }

  async save(owner: OwnerAccount): Promise<void> {
    await this.mutate((state) => ({ ...state, owner }));
  }

  async claim(identifier: string, expiresAt: number): Promise<boolean> {
    let claimed = false;
    await this.mutate((state) => {
      const replayExpirations = Object.fromEntries(
        Object.entries(state.replayExpirations).filter(([, expiry]) => expiry > this.now()),
      );
      if ((replayExpirations[identifier] ?? 0) > this.now()) return state;
      replayExpirations[identifier] = expiresAt;
      claimed = true;
      return { ...state, replayExpirations };
    });
    return claimed;
  }

  private state(): Promise<TelegramState> {
    this.statePromise ??= this.read();
    return this.statePromise;
  }

  private async read(): Promise<TelegramState> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as TelegramState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { owner: null, replayExpirations: {} };
      }
      throw new Error('Unable to read Telegram local state', { cause: error });
    }
  }

  private async mutate(transform: (state: TelegramState) => TelegramState): Promise<void> {
    const operation = this.mutation.then(async () => {
      const next = transform(await this.state());
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.path);
      this.statePromise = Promise.resolve(next);
    });
    this.mutation = operation.catch(() => undefined);
    await operation;
  }
}

export class LocalTelegramSecurityAudit implements TelegramSecurityAudit {
  constructor(private readonly path: string) {}

  async record(event: {
    readonly event: string;
    readonly userId?: number;
    readonly chatId?: number;
    readonly reason: string;
  }): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(
      this.path,
      `${JSON.stringify({ ...event, occurredAt: new Date().toISOString() })}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
  }
}

interface PreferenceState {
  readonly preferences: Readonly<Record<string, TelegramPreferences>>;
  readonly pendingModels: Readonly<
    Record<
      string,
      { readonly userId: number; readonly model: ModelChoice; readonly expiresAt: number }
    >
  >;
}

export class LocalTelegramPreferenceStore implements TelegramPreferenceStore {
  private mutation: Promise<void> = Promise.resolve();
  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
  ) {}
  async load(userId: number): Promise<TelegramPreferences> {
    return (await this.read()).preferences[String(userId)] ?? { notificationLevel: 'NORMAL' };
  }
  async save(userId: number, preferences: TelegramPreferences): Promise<void> {
    await this.mutate((state) => ({
      ...state,
      preferences: { ...state.preferences, [String(userId)]: preferences },
    }));
  }
  async putPendingModel(
    reference: string,
    userId: number,
    model: ModelChoice,
    expiresAt: number,
  ): Promise<void> {
    await this.mutate((state) => ({
      ...state,
      pendingModels: { ...state.pendingModels, [reference]: { userId, model, expiresAt } },
    }));
  }
  async takePendingModel(reference: string, userId: number): Promise<ModelChoice | null> {
    let selected: ModelChoice | null = null;
    await this.mutate((state) => {
      const pendingModels = { ...state.pendingModels };
      const candidate = pendingModels[reference];
      delete pendingModels[reference];
      if (candidate?.userId === userId && candidate.expiresAt > this.now())
        selected = candidate.model;
      return { ...state, pendingModels };
    });
    return selected;
  }
  private async read(): Promise<PreferenceState> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as PreferenceState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { preferences: {}, pendingModels: {} };
      }
      throw new Error('Unable to read Telegram preferences', { cause: error });
    }
  }
  private async mutate(transform: (state: PreferenceState) => PreferenceState): Promise<void> {
    const operation = this.mutation.then(async () => {
      const next = transform(await this.read());
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.path);
    });
    this.mutation = operation.catch(() => undefined);
    await operation;
  }
}
