import type { CompiledTerminalProfile } from '@arcc/tools';
import type { ExactCommandExecutor } from './git-service.js';
import type { SecureTerminalRunner } from './terminal-runner.js';

export class SecureExactCommandExecutor implements ExactCommandExecutor {
  constructor(private readonly runner: SecureTerminalRunner) {}

  execute(input: Parameters<ExactCommandExecutor['execute']>[0]) {
    const profile: CompiledTerminalProfile = {
      name: input.profile,
      executable: input.executable,
      args: [...input.args],
      cwd: input.cwd,
      environmentAllowlist: [],
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
      network: input.network,
      mutatesProject: true,
      kind: 'NORMAL',
      risk: input.network === 'ALLOW' ? 'HIGH' : 'MEDIUM',
      actionCategory: input.network === 'ALLOW' ? 'NETWORK_ACCESS' : 'WRITE',
      commandHash: input.commandHash,
    };
    return this.runner.execute({
      profile,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  }
}
