import type { ProjectManifest } from '@arcc/tools';
import { describe, expect, it, vi } from 'vitest';
import { ControlledDockerService } from './docker-service.js';
import type { ExactCommandExecutor } from './git-service.js';

const manifest = { rootPath: 'C:\\project' } as ProjectManifest;

function harness(outputs: readonly string[] = []) {
  let index = 0;
  const execute = vi.fn(async () => ({
    status: 'COMPLETED' as const,
    exitCode: 0,
    stdout: outputs[index++] ?? '',
    stderr: '',
    outputBytes: 0,
    redactions: 0,
  }));
  const paths = {
    authorize: vi.fn(async () => ({ canonicalPath: 'C:\\project\\compose.yml' })),
  };
  return {
    execute,
    service: new ControlledDockerService(
      manifest,
      {
        projectName: 'arcc-test',
        composeFiles: ['compose.yml'],
        services: ['api'],
        imagePrefixes: ['registry.example/arcc'],
        environment: 'LOCAL',
      },
      'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
      { execute } as ExactCommandExecutor,
      paths as never,
    ),
  };
}

describe('ControlledDockerService', () => {
  it('pins compose commands to project and allowlisted files/services', async () => {
    const { service, execute } = harness();
    await service.logs('api', 50);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          'compose',
          '--project-name',
          'arcc-test',
          '--file',
          'C:\\project\\compose.yml',
          'logs',
          '--no-color',
          '--tail',
          '50',
          'api',
        ],
      }),
    );
  });

  it('refuses containers and images outside the configured scope', async () => {
    const { service, execute } = harness();
    await expect(service.logs('database')).rejects.toThrow('service_outside_scope');
    await expect(service.publish('another/image:latest')).rejects.toThrow('image_outside_scope');
    expect(execute).not.toHaveBeenCalled();
  });

  it('inspects only container ids resolved through the scoped compose service', async () => {
    const { service, execute } = harness(['abcdef123456\n', 'inspection']);
    await expect(service.inspect('api')).resolves.toBe('inspection');
    expect(execute.mock.calls[1]?.[0]).toMatchObject({ args: ['inspect', 'abcdef123456'] });
  });
});
