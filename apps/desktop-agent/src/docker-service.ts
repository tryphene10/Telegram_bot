import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import type { ProjectManifest } from '@arcc/tools';
import { ProjectPathGuard } from '@arcc/tools';
import type { ExactCommandExecutor } from './git-service.js';

export interface DockerProjectScope {
  readonly projectName: string;
  readonly composeFiles: readonly string[];
  readonly services: readonly string[];
  readonly imagePrefixes: readonly string[];
  readonly environment: 'LOCAL' | 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
}

export class DockerServiceError extends Error {
  constructor(readonly reason: string) {
    super(`Controlled Docker operation failed: ${reason}`);
    this.name = 'DockerServiceError';
  }
}

export class ControlledDockerService {
  private composePrefix?: readonly string[];

  constructor(
    private readonly manifest: ProjectManifest,
    private readonly scope: DockerProjectScope,
    private readonly dockerExecutable: string,
    private readonly commands: ExactCommandExecutor,
    private readonly paths = new ProjectPathGuard(),
  ) {
    if (
      !win32.isAbsolute(dockerExecutable) ||
      win32.basename(dockerExecutable).toLowerCase() !== 'docker.exe'
    ) {
      throw new DockerServiceError('absolute_docker_executable_required');
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/u.test(scope.projectName) || scope.composeFiles.length === 0) {
      throw new DockerServiceError('invalid_project_scope');
    }
  }

  get environment(): DockerProjectScope['environment'] {
    return this.scope.environment;
  }

  async ps(signal?: AbortSignal): Promise<string> {
    return (await this.compose(['ps', '--format', 'json'], signal, false)).stdout;
  }

  async logs(service: string, tail = 200, signal?: AbortSignal): Promise<string> {
    this.assertService(service);
    if (!Number.isSafeInteger(tail) || tail < 1 || tail > 2_000)
      throw new DockerServiceError('invalid_log_limit');
    return (
      await this.compose(['logs', '--no-color', '--tail', String(tail), service], signal, false)
    ).stdout;
  }

  async inspect(service: string, signal?: AbortSignal): Promise<string> {
    this.assertService(service);
    const identifiers = (await this.compose(['ps', '-q', service], signal, false)).stdout
      .split(/\s+/u)
      .filter(Boolean);
    if (identifiers.length === 0 || identifiers.some((id) => !/^[a-f0-9]{12,64}$/u.test(id))) {
      throw new DockerServiceError('service_container_not_found');
    }
    return (await this.run(['inspect', ...identifiers], signal, false)).stdout;
  }

  async build(service: string, signal?: AbortSignal): Promise<void> {
    this.assertService(service);
    await this.compose(['build', service], signal, true, 900_000);
  }

  async control(
    operation: 'UP' | 'STOP' | 'RESTART' | 'DOWN',
    services: readonly string[],
    signal?: AbortSignal,
  ): Promise<void> {
    services.forEach((service) => this.assertService(service));
    if (operation !== 'DOWN' && services.length === 0)
      throw new DockerServiceError('services_required');
    const command = operation.toLowerCase();
    const args = command === 'up' ? ['up', '--detach', ...services] : [command, ...services];
    await this.compose(args, signal, command === 'up');
  }

  async publish(image: string, signal?: AbortSignal): Promise<void> {
    if (
      !image ||
      image.startsWith('-') ||
      /[\s\0\r\n]/u.test(image) ||
      !this.scope.imagePrefixes.some(
        (prefix) =>
          image === prefix || image.startsWith(`${prefix}/`) || image.startsWith(`${prefix}:`),
      )
    ) {
      throw new DockerServiceError('image_outside_scope');
    }
    await this.run(['push', image], signal, true, 900_000);
  }

  private assertService(service: string): void {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(service) ||
      !this.scope.services.includes(service)
    ) {
      throw new DockerServiceError('service_outside_scope');
    }
  }

  private async prefix(): Promise<readonly string[]> {
    if (this.composePrefix) return this.composePrefix;
    const files = await Promise.all(
      this.scope.composeFiles.map(
        async (file) => (await this.paths.authorize(this.manifest, file, 'READ')).canonicalPath,
      ),
    );
    this.composePrefix = [
      'compose',
      '--project-name',
      this.scope.projectName,
      ...files.flatMap((file) => ['--file', file]),
    ];
    return this.composePrefix;
  }

  private async compose(
    args: readonly string[],
    signal: AbortSignal | undefined,
    network: boolean,
    timeoutMs = 300_000,
  ) {
    return this.run([...(await this.prefix()), ...args], signal, network, timeoutMs);
  }

  private async run(
    args: readonly string[],
    signal: AbortSignal | undefined,
    network: boolean,
    timeoutMs = 120_000,
  ) {
    const commandHash = createHash('sha256')
      .update(
        JSON.stringify({ executable: this.dockerExecutable, args, cwd: this.manifest.rootPath }),
      )
      .digest('hex');
    const result = await this.commands.execute({
      executable: this.dockerExecutable,
      args,
      cwd: this.manifest.rootPath,
      timeoutMs,
      maxOutputBytes: 10 * 1024 * 1024,
      commandHash,
      profile: `docker.${args.at(-1) ?? 'command'}`,
      network: network ? 'ALLOW' : 'DENY',
      ...(signal === undefined ? {} : { signal }),
    });
    if (result.exitCode !== 0) throw new DockerServiceError('docker_exit_nonzero');
    return result;
  }
}
