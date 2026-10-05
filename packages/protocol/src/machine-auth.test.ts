import { describe, expect, it, vi } from 'vitest';
import {
  MachinePairingService,
  type MachineCredentialVault,
  type MachineIdentityRecord,
  type MachineIdentityStore,
} from './machine-auth.js';

class Identities implements MachineIdentityStore {
  readonly values = new Map<string, MachineIdentityRecord>();
  async find(id: string) {
    return this.values.get(id) ?? null;
  }
  async save(machine: MachineIdentityRecord) {
    this.values.set(machine.machineId, machine);
  }
}

describe('MachinePairingService', () => {
  it('issues one credential for one unexpired pairing code', async () => {
    const identities = new Identities();
    const set = vi.fn();
    const revoke = vi.fn();
    const service = new MachinePairingService(
      identities,
      { set, revoke } as MachineCredentialVault,
      () => 1_000,
    );
    const code = service.begin();
    const issued = await service.pair('Windows PC', code);
    expect(issued.machine.status).toBe('OFFLINE');
    expect(issued.credential).toHaveLength(44);
    await expect(service.pair('Other PC', code)).rejects.toThrow('Machine pairing denied');
    expect(set).toHaveBeenCalledOnce();
  });

  it('rotates then revokes credentials without restoring access', async () => {
    const identities = new Identities();
    const vault = { set: vi.fn(), revoke: vi.fn() };
    const service = new MachinePairingService(identities, vault, () => 1_000);
    const issued = await service.pair('Windows PC', service.begin());
    const rotated = await service.rotate(issued.machine.machineId);
    expect(rotated.machine.credentialVersion).toBe(2);
    expect(vault.revoke).toHaveBeenCalledWith(issued.machine.credentialId);
    await service.revoke(issued.machine.machineId);
    await expect(service.rotate(issued.machine.machineId)).rejects.toThrow('Machine is not active');
  });
});
