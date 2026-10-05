import { describe, expect, it } from 'vitest';
import {
  InvalidProjectManifestError,
  resolveDirectoryLimit,
  suggestStack,
  validateProjectManifest,
} from './project-manifest.js';

const valid = {
  version: 1,
  projectId: 'project-1',
  machineId: 'machine-1',
  rootPath: 'D:\\Projects\\Safe',
  stack: ['nodejs'],
  environments: ['development'],
  commands: { test: { executable: 'pnpm.cmd', args: ['test'], workingDirectory: '.' } },
  allowedPaths: ['.', 'src'],
  deniedPaths: ['private'],
  protectedFiles: ['.env'],
  directoryLimits: { '.': { maxFiles: 10_000, maxBytes: 1_000_000_000 } },
};

describe('project manifest', () => {
  it('accepts a complete versioned manifest', () => {
    expect(validateProjectManifest(valid)).toEqual(valid);
  });

  it('blocks invalid versions, UNC roots and traversal rules', () => {
    expect(() =>
      validateProjectManifest({
        ...valid,
        version: 2,
        rootPath: '\\\\server\\share',
        allowedPaths: ['..\\escape'],
      }),
    ).toThrow(InvalidProjectManifestError);
  });

  it('returns stack evidence only as suggestions', () => {
    expect(suggestStack(['package.json', 'Dockerfile'])).toEqual([
      { stack: 'nodejs', evidence: 'package.json' },
      { stack: 'docker', evidence: 'container manifest' },
    ]);
  });

  it('selects the most specific directory limit', () => {
    const manifest = validateProjectManifest({
      ...valid,
      directoryLimits: {
        '.': { maxFiles: 10_000, maxBytes: 1_000_000 },
        artifacts: { maxFiles: 100, maxBytes: 50_000 },
      },
    });
    expect(resolveDirectoryLimit(manifest, 'artifacts\\report.txt')).toEqual({
      maxFiles: 100,
      maxBytes: 50_000,
    });
    expect(resolveDirectoryLimit(manifest, 'src\\index.ts')).toEqual({
      maxFiles: 10_000,
      maxBytes: 1_000_000,
    });
  });
});
