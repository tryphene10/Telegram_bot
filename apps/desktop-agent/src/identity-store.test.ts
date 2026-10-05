import type { IssuedMachineCredential, MachineIdentityRecord } from '@arcc/protocol';
import { describe, expect, it, vi } from 'vitest';
import { DesktopIdentityStore, type MachineMetadataStore } from './identity-store.js';

describe('DesktopIdentityStore', () => {
  it('separates public machine metadata from the protected credential', async () => {
    let metadata: MachineIdentityRecord | null = null;
    const values = new Map<string, string>();
    const save = vi.fn(async (machine: MachineIdentityRecord) => {
      metadata = machine;
    });
    const vault = {
      set: vi.fn(async (name: string, value: string) => values.set(name, value)),
      get: vi.fn((name: string) => values.get(name) ?? ''),
      revoke: vi.fn(async () => undefined),
    };
    const store = new DesktopIdentityStore(
      { load: async () => metadata, save } as MachineMetadataStore,
      vault,
    );
    const issued: IssuedMachineCredential = {
      machine: {
        machineId: 'machine-id',
        displayName: 'PC',
        status: 'OFFLINE',
        credentialId: 'credential-id',
        credentialVersion: 1,
      },
      credential: 'MACHINE-CREDENTIAL-CANARY',
    };
    await store.accept(issued);
    expect(JSON.stringify(metadata)).not.toContain('MACHINE-CREDENTIAL-CANARY');
    await expect(store.load()).resolves.toEqual(issued);
  });
});
