import {
  PinAuthorizationService,
  type PinAuditSink,
  type PinChallenge,
  type PinChallengeStore,
} from '@arcc/security';

class MemoryPinChallengeStore implements PinChallengeStore {
  private readonly values = new Map<string, PinChallenge>();
  async get(id: string): Promise<PinChallenge | null> {
    return this.values.get(id) ?? null;
  }
  async save(challenge: PinChallenge): Promise<void> {
    this.values.set(challenge.id, challenge);
  }
}

export class TelegramStrongApprovalGate {
  private readonly store = new MemoryPinChallengeStore();
  private readonly service: PinAuthorizationService;
  private readonly challenges = new Map<string, string>();

  constructor(pinHash: string, audit: PinAuditSink) {
    this.service = new PinAuthorizationService(pinHash, this.store, audit);
  }

  async authorize(actionId: string, pin: string): Promise<void> {
    let challengeId = this.challenges.get(actionId);
    if (!challengeId) {
      const challenge = await this.service.create(actionId);
      challengeId = challenge.id;
      this.challenges.set(actionId, challengeId);
    }
    await this.service.authorize(challengeId, actionId, pin);
    this.challenges.delete(actionId);
  }
}
