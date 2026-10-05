import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '@arcc/tools';
import { registerComputerUseTools } from './computer-use-toolset.js';
import { hashDesktopAction, type DesktopAction } from './computer-use-core.js';

const action: DesktopAction = {
  id: 'save',
  kind: 'UIA_INVOKE',
  channel: 'UIA',
  applicationKey: 'editor',
  expectedWindow: { handle: '42' },
  selector: { automationId: 'save' },
  risk: 'MEDIUM',
  verification: { kind: 'UIA', expected: 'save available' },
};

describe('computer use toolset', () => {
  it('registers observation, window, UIA and raw input separately', () => {
    const registry = new ToolRegistry();
    registerComputerUseTools(registry, { observe: vi.fn() }, { execute: vi.fn() } as never);
    expect(registry.descriptors()).toEqual([
      expect.objectContaining({ name: 'computer.observe', risk: 'LOW' }),
      expect.objectContaining({ name: 'computer.window', risk: 'CRITICAL' }),
      expect.objectContaining({ name: 'computer.uia', risk: 'CRITICAL' }),
      expect.objectContaining({ name: 'computer.input', risk: 'CRITICAL' }),
    ]);
  });

  it('passes the exact registry authorization to the core policy gate', async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ actionHash: 'a'.repeat(64), receipt: {}, evidence: [] }));
    registerComputerUseTools(registry, { observe: vi.fn() }, { execute } as never);
    const actionHash = hashDesktopAction('mission-1', action);
    await registry.execute(
      'computer.uia',
      { missionId: 'mission-1', action },
      { decision: 'REQUIRE_APPROVAL', actionHash, authorizationId: 'approval-1' },
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        registryAuthorization: {
          decision: 'REQUIRE_APPROVAL',
          actionHash,
          authorizationId: 'approval-1',
        },
      }),
    );
  });

  it('refuses to route raw input through the lower-risk UIA tool', async () => {
    const registry = new ToolRegistry();
    registerComputerUseTools(registry, { observe: vi.fn() }, { execute: vi.fn() } as never);
    await expect(
      registry.execute(
        'computer.uia',
        {
          missionId: 'mission-1',
          action: { ...action, kind: 'INPUT_CLICK', channel: 'VISION_INPUT' },
        },
        { decision: 'ALLOW', actionHash: 'a'.repeat(64) },
      ),
    ).rejects.toThrow('computer_use_action_tool_mismatch');
  });
});
