import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { MachineStatus } from './index.js';

export interface MachineIdentityRecord {
  readonly machineId: string;
  readonly displayName: string;
  readonly status: MachineStatus;
  readonly credentialId: string;
  readonly credentialVersion: number;
}

export interface MachineIdentityStore {
  find(machineId: string): Promise<MachineIdentityRecord | null>;
  save(machine: MachineIdentityRecord): Promise<void>;
}

export interface MachineCredentialVault {
  set(credentialId: string, value: string): Promise<void>;
  revoke(credentialId: string): Promise<void>;
}

export interface IssuedMachineCredential {
  readonly machine: MachineIdentityRecord;
  readonly credential: string;
}

function pairingDigest(code: string): Buffer {
  return createHash('sha256').update(code.trim().toUpperCase(), 'utf8').digest();
}

export class MachinePairingService {
  private pending: { readonly digest: Buffer; readonly expiresAt: number } | null = null;

  constructor(
    private readonly identities: MachineIdentityStore,
    private readonly credentials: MachineCredentialVault,
    private readonly now: () => number = Date.now,
  ) {}

  begin(lifetimeMs = 5 * 60 * 1000): string {
    const code = randomBytes(6).toString('hex').toUpperCase();
    this.pending = { digest: pairingDigest(code), expiresAt: this.now() + lifetimeMs };
    return code;
  }

  async pair(displayName: string, code: string): Promise<IssuedMachineCredential> {
    const actual = pairingDigest(code);
    if (
      !this.pending ||
      this.pending.expiresAt <= this.now() ||
      !timingSafeEqual(actual, this.pending.digest)
    ) {
      throw new Error('Machine pairing denied');
    }
    if (!displayName.trim()) throw new Error('Machine display name is required');
    const credential = randomBytes(32).toString('base64');
    const machine: MachineIdentityRecord = {
      machineId: randomUUID(),
      displayName,
      status: 'OFFLINE',
      credentialId: randomUUID(),
      credentialVersion: 1,
    };
    await this.credentials.set(machine.credentialId, credential);
    await this.identities.save(machine);
    this.pending.digest.fill(0);
    this.pending = null;
    return { machine, credential };
  }

  async rotate(machineId: string): Promise<IssuedMachineCredential> {
    const current = await this.requireActive(machineId);
    const credential = randomBytes(32).toString('base64');
    const next: MachineIdentityRecord = {
      ...current,
      credentialId: randomUUID(),
      credentialVersion: current.credentialVersion + 1,
    };
    await this.credentials.set(next.credentialId, credential);
    await this.identities.save(next);
    await this.credentials.revoke(current.credentialId);
    return { machine: next, credential };
  }

  async revoke(machineId: string): Promise<void> {
    const current = await this.requireActive(machineId);
    await this.identities.save({ ...current, status: 'REVOKED' });
    await this.credentials.revoke(current.credentialId);
  }

  private async requireActive(machineId: string): Promise<MachineIdentityRecord> {
    const machine = await this.identities.find(machineId);
    if (!machine || machine.status === 'REVOKED') throw new Error('Machine is not active');
    return machine;
  }
}
