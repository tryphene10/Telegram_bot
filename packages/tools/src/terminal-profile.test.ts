import { describe, expect, it } from 'vitest';
import type { ProjectManifest } from './project-manifest.js';
import { ProjectPathGuard } from './path-guard.js';
import {
  buildRestrictedEnvironment,
  compileTerminalProfile,
  type CompiledTerminalProfile,
} from './terminal-profile.js';

const canonicalize = async (path: string) => path.replaceAll('/', '\\');
const base: ProjectManifest = {
  version: 1,
  projectId: 'project',
  machineId: 'machine',
  rootPath: 'C:\\project',
  stack: [],
  environments: ['LOCAL'],
  commands: {
    identity: {
      executable: 'C:\\Windows\\System32\\whoami.exe',
      args: ['/user'],
      workingDirectory: 'src',
      environmentAllowlist: ['ARCC_TEST_VALUE'],
      timeoutMs: 5_000,
      maxOutputBytes: 10_000,
    },
  },
  allowedPaths: ['src'],
  deniedPaths: [],
  protectedFiles: [],
  directoryLimits: {},
};

const options = {
  canonicalizeExecutable: canonicalize,
  pathGuard: new ProjectPathGuard(canonicalize),
};

function withCommand(executable: string, args: readonly string[]): ProjectManifest {
  return {
    ...base,
    commands: {
      bad: { executable, args, workingDirectory: 'src' },
    },
  };
}

describe('terminal profiles', () => {
  it('compiles only an exact allowlisted direct command', async () => {
    const profile = await compileTerminalProfile(base, 'identity', options);
    expect(profile).toMatchObject({ risk: 'LOW', actionCategory: 'READ', network: 'DENY' });
    expect(profile.commandHash).toMatch(/^[a-f0-9]{64}$/u);
    await expect(compileTerminalProfile(base, 'missing', options)).rejects.toMatchObject({
      reason: 'command_not_allowlisted',
    });
  });

  it.each([
    ['value & whoami', 'shell_syntax_forbidden'],
    ['$(whoami)', 'shell_syntax_forbidden'],
    ['%COMSPEC%', 'shell_syntax_forbidden'],
    ['-EncodedCommand', 'dynamic_code_or_encoded_command'],
    ['ExecutionPolicy Bypass', 'elevation_or_evasion'],
    ['A'.repeat(100), 'opaque_encoding'],
    ['line\nnext', 'shell_syntax_forbidden'],
    ['zero\0byte', 'invalid_argument_encoding'],
  ])('rejects a known bypass argument', async (argument, reason) => {
    await expect(
      compileTerminalProfile(withCommand('C:\\safe\\tool.exe', [argument]), 'bad', options),
    ).rejects.toMatchObject({ reason });
  });

  it.each(['cmd.exe', 'powershell.exe', 'mshta.exe', 'git.exe', 'docker.exe'])(
    'rejects forbidden shell or deferred executable %s',
    async (name) => {
      await expect(
        compileTerminalProfile(withCommand(`C:\\Windows\\${name}`, ['version']), 'bad', options),
      ).rejects.toMatchObject({ reason: 'shell_or_lolbin_forbidden' });
    },
  );

  it('classifies network and long-running profiles for approval', async () => {
    const network = await compileTerminalProfile(
      {
        ...base,
        commands: {
          install: {
            executable: 'C:\\tools\\pnpm.exe',
            args: ['install'],
            workingDirectory: 'src',
            network: 'ALLOW',
            kind: 'DEPENDENCY_INSTALL',
          },
        },
      },
      'install',
      options,
    );
    expect(network).toMatchObject({ risk: 'HIGH', actionCategory: 'NETWORK_ACCESS' });
    const persistent = await compileTerminalProfile(
      {
        ...base,
        commands: {
          server: {
            executable: 'C:\\safe\\server.exe',
            args: ['serve'],
            workingDirectory: 'src',
            kind: 'PERSISTENT_PROCESS',
          },
        },
      },
      'server',
      options,
    );
    expect(persistent).toMatchObject({ risk: 'MEDIUM', actionCategory: 'PERSISTENT_PROCESS' });
  });

  it('passes only base and explicitly allowed environment variables', () => {
    const profile = {
      environmentAllowlist: ['ARCC_TEST_VALUE'],
      network: 'DENY',
    } as CompiledTerminalProfile;
    const result = buildRestrictedEnvironment(
      profile,
      { ARCC_TEST_VALUE: 'allowed', SECRET_TOKEN: 'blocked' },
      { SYSTEMROOT: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Owner' },
    );
    expect(result.ARCC_TEST_VALUE).toBe('allowed');
    expect(result.SECRET_TOKEN).toBeUndefined();
    expect(result.USERPROFILE).toBeUndefined();
    expect(result.HTTPS_PROXY).toBe('http://127.0.0.1:9');
  });
});
