export interface ToolDescriptor {
  readonly name: string;
  readonly risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly enabled: boolean;
}

export const EMPTY_TOOL_REGISTRY: readonly ToolDescriptor[] = Object.freeze([]);

export * from './project-manifest.js';
export * from './path-guard.js';
export * from './project-lock.js';
export * from './tool-registry.js';
export * from './filesystem-tools.js';
export * from './system-tools.js';
export * from './transfer-guard.js';
export * from './screenshot-service.js';
export * from './fundamental-toolset.js';
export * from './terminal-profile.js';
export * from './git-guard.js';
export * from './development-policy.js';
