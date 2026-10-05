import type { IssuedMachineCredential, MachineIdentityRecord } from '@arcc/protocol';

export interface MachineMetadataStore {
  load(): Promise<MachineIdentityRecord | null>;
  save(machine: MachineIdentityRecord): Promise<void>;
}

export interface ProtectedSecretStore {
  set(name: string, value: string): Promise<unknown>;
  get(name: string): string;
  revoke(name: string): Promise<void>;
}

export interface LoadedDesktopIdentity {
  readonly machine: MachineIdentityRecord;
  readonly credential: string;
}

export class DesktopIdentityStore {
  constructor(
    private readonly metadata: MachineMetadataStore,
    private readonly vault: ProtectedSecretStore,
  ) {}

  async accept(issued: IssuedMachineCredential): Promise<void> {
    await this.vault.set(this.secretName(issued.machine.credentialId), issued.credential);
    await this.metadata.save(issued.machine);
  }

  async load(): Promise<LoadedDesktopIdentity | null> {
    const machine = await this.metadata.load();
    if (!machine || machine.status === 'REVOKED') return null;
    return { machine, credential: this.vault.get(this.secretName(machine.credentialId)) };
  }

  async replace(issued: IssuedMachineCredential): Promise<void> {
    const previous = await this.metadata.load();
    await this.accept(issued);
    if (previous) await this.vault.revoke(this.secretName(previous.credentialId));
  }

  private secretName(credentialId: string): string {
    return `machine-credential:${credentialId}`;
  }
}
