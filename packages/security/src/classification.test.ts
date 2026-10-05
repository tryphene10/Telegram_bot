import { describe, expect, it } from 'vitest';
import { classifyContent, markCloudSafeUserInstruction } from './classification.js';

describe('content classification', () => {
  it.each([
    'CODE',
    'DIFF',
    'FILE_CONTENT',
    'TERMINAL_LOG',
    'SCREENSHOT',
    'PROJECT_MEMORY',
  ] as const)('classifies %s as local-only', (kind) => {
    expect(classifyContent(kind, 'canary').classification).toBe('LOCAL_ONLY');
  });

  it('requires an explicit function to mark an instruction cloud-safe', () => {
    expect(classifyContent('USER_INSTRUCTION', 'hello').classification).toBe('LOCAL_ONLY');
    expect(markCloudSafeUserInstruction('hello').classification).toBe('CLOUD_SAFE');
  });
});
