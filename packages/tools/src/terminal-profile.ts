import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import type { ActionCategory, RiskLevel } from '@arcc/policies';
import type { ProjectManifest } from './project-manifest.js';
import { canonicalizeWindowsPath, ProjectPathGuard, type PathCanonicalizer } from './path-guard.js';

const FORBIDDEN_EXECUTABLES = new Set([
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'wscript.exe',
  'cscript.exe',
  'mshta.exe',
  'rundll32.exe',
  'regsvr32.exe',
  'reg.exe',
  'schtasks.exe',
  'sc.exe',
  'wmic.exe',
  'curl.exe',
  'wget.exe',
  'certutil.exe',
  'bitsadmin.exe',
  'git.exe',
  'docker.exe',
]);

const NETWORK_CAPABLE = new Set([
  'npm.exe',
  'npm.cmd',
  'pnpm.exe',
  'pnpm.cmd',
  'yarn.exe',
  'yarn.cmd',
  'pip.exe',
  'pip3.exe',
  'poetry.exe',
  'uv.exe',
  'cargo.exe',
  'node.exe',
  'python.exe',
  'python3.exe',
]);

const INTERPRETERS = new Set(['node.exe', 'python.exe', 'python3.exe']);
const BASE_ENVIRONMENT = ['SYSTEMROOT', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP'] as const;

export class TerminalProfileError extends Error {
  constructor(readonly reason: string) {
    super(`Terminal profile denied: ${reason}`);
    this.name = 'TerminalProfileError';
  }
}

export interface CompiledTerminalProfile {
  readonly name: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environmentAllowlist: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly network: 'DENY' | 'ALLOW';
  readonly mutatesProject: boolean;
  readonly kind: 'NORMAL' | 'DEPENDENCY_INSTALL' | 'PERSISTENT_PROCESS';
  readonly risk: RiskLevel;
  readonly actionCategory: ActionCategory;
  readonly commandHash: string;
}

function validateArgument(argument: string): void {
  const hasControlCharacter = [...argument].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  });
  if (!argument || argument.length > 4_096 || hasControlCharacter || /\p{Cf}/u.test(argument)) {
    throw new TerminalProfileError('invalid_argument_encoding');
  }
  if (/[&|><^`\r\n]/u.test(argument) || /\$\(|\$\{|--%|%[^%]+%/u.test(argument)) {
    throw new TerminalProfileError('shell_syntax_forbidden');
  }
  if (/^(?:-|\/)(?:e|p|c|enc|encodedcommand|command)$/iu.test(argument)) {
    throw new TerminalProfileError('dynamic_code_or_encoded_command');
  }
  if (/\b(?:runas|bypass|hidden|windowstyle|executionpolicy)\b/iu.test(argument)) {
    throw new TerminalProfileError('elevation_or_evasion');
  }
  if (/^[A-Za-z0-9+/]{80,}={0,2}$/u.test(argument)) {
    throw new TerminalProfileError('opaque_encoding');
  }
}

function inferredKind(
  executable: string,
  args: readonly string[],
): CompiledTerminalProfile['kind'] {
  const name = win32.basename(executable).toLowerCase();
  const normalized = args.map((value) => value.toLowerCase());
  if (
    [
      'npm.exe',
      'npm.cmd',
      'pnpm.exe',
      'pnpm.cmd',
      'yarn.exe',
      'yarn.cmd',
      'pip.exe',
      'pip3.exe',
      'poetry.exe',
      'uv.exe',
      'cargo.exe',
    ].includes(name) &&
    normalized.some((value) => ['install', 'add', 'update', 'upgrade'].includes(value))
  ) {
    return 'DEPENDENCY_INSTALL';
  }
  if (normalized.some((value) => ['dev', 'watch', 'serve', '--watch'].includes(value))) {
    return 'PERSISTENT_PROCESS';
  }
  return 'NORMAL';
}

export async function compileTerminalProfile(
  manifest: ProjectManifest,
  profileName: string,
  options: {
    readonly pathGuard?: ProjectPathGuard;
    readonly canonicalizeExecutable?: PathCanonicalizer;
  } = {},
): Promise<CompiledTerminalProfile> {
  if (!/^[a-z][a-z0-9._-]{0,63}$/u.test(profileName)) {
    throw new TerminalProfileError('invalid_profile_name');
  }
  const command = manifest.commands[profileName];
  if (!command) throw new TerminalProfileError('command_not_allowlisted');
  if (!win32.isAbsolute(command.executable) || command.executable.startsWith('\\')) {
    throw new TerminalProfileError('absolute_local_executable_required');
  }
  const executable = await (options.canonicalizeExecutable ?? canonicalizeWindowsPath)(
    command.executable,
  );
  const executableName = win32.basename(executable).toLowerCase();
  if (
    FORBIDDEN_EXECUTABLES.has(executableName) ||
    ['.cmd', '.bat', '.ps1', '.vbs', '.js'].includes(win32.extname(executableName))
  ) {
    throw new TerminalProfileError('shell_or_lolbin_forbidden');
  }
  command.args.forEach(validateArgument);
  if (
    INTERPRETERS.has(executableName) &&
    command.args.some((argument) => ['-e', '-p', '-c'].includes(argument.toLowerCase()))
  ) {
    throw new TerminalProfileError('interpreter_eval_forbidden');
  }
  const network = command.network ?? 'DENY';
  if (network === 'DENY' && NETWORK_CAPABLE.has(executableName)) {
    throw new TerminalProfileError('network_capable_executable_requires_network_profile');
  }
  const detectedKind = inferredKind(executable, command.args);
  const kind = command.kind ?? detectedKind;
  if (detectedKind !== 'NORMAL' && command.kind !== detectedKind) {
    throw new TerminalProfileError('command_kind_mismatch');
  }
  const cwd = await (options.pathGuard ?? new ProjectPathGuard()).authorize(
    manifest,
    command.workingDirectory,
    command.mutatesProject ? 'WRITE' : 'READ',
  );
  const actionCategory: ActionCategory =
    network === 'ALLOW'
      ? 'NETWORK_ACCESS'
      : kind === 'DEPENDENCY_INSTALL'
        ? 'DEPENDENCY_INSTALL'
        : kind === 'PERSISTENT_PROCESS'
          ? 'PERSISTENT_PROCESS'
          : command.mutatesProject
            ? 'WRITE'
            : 'READ';
  const risk: RiskLevel =
    network === 'ALLOW' || kind === 'DEPENDENCY_INSTALL'
      ? 'HIGH'
      : kind === 'PERSISTENT_PROCESS' || command.mutatesProject
        ? 'MEDIUM'
        : 'LOW';
  const identity = JSON.stringify({
    profileName,
    executable,
    args: command.args,
    cwd: cwd.canonicalPath,
    network,
    kind,
  });
  return {
    name: profileName,
    executable,
    args: [...command.args],
    cwd: cwd.canonicalPath,
    environmentAllowlist: [...(command.environmentAllowlist ?? [])],
    timeoutMs: command.timeoutMs ?? 120_000,
    maxOutputBytes: command.maxOutputBytes ?? 1024 * 1024,
    network,
    mutatesProject: command.mutatesProject ?? false,
    kind,
    risk,
    actionCategory,
    commandHash: createHash('sha256').update(identity).digest('hex'),
  };
}

export function buildRestrictedEnvironment(
  profile: CompiledTerminalProfile,
  supplied: Readonly<Record<string, string | undefined>>,
  host: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const key of BASE_ENVIRONMENT) {
    if (host[key]) result[key] = host[key];
  }
  const allowed = new Set(profile.environmentAllowlist.map((name) => name.toUpperCase()));
  for (const [name, value] of Object.entries(supplied)) {
    if (!allowed.has(name.toUpperCase()) || value === undefined) continue;
    result[name.toUpperCase()] = value;
  }
  if (profile.network === 'DENY') {
    result.HTTP_PROXY = 'http://127.0.0.1:9';
    result.HTTPS_PROXY = 'http://127.0.0.1:9';
    result.ALL_PROXY = 'http://127.0.0.1:9';
    result.NO_PROXY = '';
    result.NPM_CONFIG_OFFLINE = 'true';
  }
  return result;
}
