export const TELEGRAM_COMMANDS = [
  'task',
  'status',
  'tasks',
  'pause',
  'resume',
  'stop',
  'projects',
  'project',
  'machines',
  'machine',
  'models',
  'model',
  'approvals',
  'approve',
  'reject',
  'files',
  'logs',
  'screen',
  'plan',
  'takeover',
  'continue',
  'retry',
  'proof',
  'queue',
  'dryrun',
  'memory',
  'forget',
  'schedule',
  'schedules',
  'schedule_pause',
  'schedule_resume',
  'schedule_run',
  'schedule_delete',
  'monitors',
  'incidents',
  'incident',
  'autonomy',
  'scheduler',
] as const;
export type OperationalCommand = (typeof TELEGRAM_COMMANDS)[number];

export type ParsedTelegramCommand =
  | { readonly kind: 'FOUNDATION'; readonly command: 'start' | 'help' | 'settings' | 'diagnostic' }
  | {
      readonly kind: 'OPERATIONAL';
      readonly command: OperationalCommand;
      readonly argument?: string;
    }
  | { readonly kind: 'TASK'; readonly objective: string }
  | { readonly kind: 'UNKNOWN' };

export interface CommandReply {
  readonly command: 'start' | 'help' | 'settings' | 'diagnostic' | 'unknown';
  readonly text: string;
}

export function parseTelegramCommand(text: string): ParsedTelegramCommand {
  const normalized = text.trim();
  if (!normalized) return { kind: 'UNKNOWN' };
  if (!normalized.startsWith('/')) return { kind: 'TASK', objective: normalized };
  const [rawCommand = '', ...tail] = normalized.split(/\s+/u);
  const command = rawCommand.slice(1).split('@')[0]?.toLowerCase() ?? '';
  const argument = tail.join(' ').trim();
  if (['start', 'help', 'settings', 'diagnostic'].includes(command)) {
    return { kind: 'FOUNDATION', command: command as 'start' | 'help' | 'settings' | 'diagnostic' };
  }
  if (TELEGRAM_COMMANDS.includes(command as OperationalCommand)) {
    return {
      kind: 'OPERATIONAL',
      command: command as OperationalCommand,
      ...(argument ? { argument } : {}),
    };
  }
  return { kind: 'UNKNOWN' };
}

export function handleFoundationCommand(text: string): CommandReply {
  const parsed = parseTelegramCommand(text);
  if (parsed.kind !== 'FOUNDATION') {
    return { command: 'unknown', text: 'Commande non reconnue. Utilisez /help.' };
  }
  switch (parsed.command) {
    case 'start':
      return { command: 'start', text: 'AI Remote Command Center est connecte.' };
    case 'help':
      return {
        command: 'help',
        text: `Commandes : ${TELEGRAM_COMMANDS.map((command) => `/${command}`).join(', ')}. Un texte libre cree une mission.`,
      };
    case 'settings':
      return {
        command: 'settings',
        text: 'Mode : EXECUTE_SAFE. Les reglages sensibles exigent un PIN.',
      };
    case 'diagnostic':
      return { command: 'diagnostic', text: 'Connexion Telegram : OK. Politique : EXECUTE_SAFE.' };
  }
}
