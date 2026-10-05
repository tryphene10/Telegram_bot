import { createHash } from 'node:crypto';
import type { ToolAuthorization } from '@arcc/tools';

export const COMPUTER_USE_CHANNELS = [
  'CONNECTOR',
  'CLI',
  'UIA',
  'BROWSER',
  'VISION_INPUT',
] as const;
export type ComputerUseChannel = (typeof COMPUTER_USE_CHANNELS)[number];
export type ComputerUseRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowSnapshot {
  readonly handle: string;
  readonly processId: number;
  readonly processName: string;
  readonly title: string;
  readonly bounds: Rectangle;
  readonly monitorId: string;
  readonly dpi: number;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly foreground: boolean;
}

export interface UiaSelector {
  readonly automationId?: string;
  readonly name?: string;
  readonly controlType?: string;
  readonly className?: string;
}

export interface DesktopObservation {
  readonly capturedAt: string;
  readonly windows: readonly WindowSnapshot[];
  readonly foregroundHandle?: string;
  readonly visualFingerprint: string;
  readonly classification: 'LOCAL_ONLY';
  readonly trust: 'DATA_ONLY';
}

export interface DesktopAction {
  readonly id: string;
  readonly kind:
    | 'WINDOW_ACTIVATE'
    | 'WINDOW_MOVE_RESIZE'
    | 'WINDOW_STATE'
    | 'UIA_INVOKE'
    | 'UIA_SELECT'
    | 'UIA_TOGGLE'
    | 'UIA_EXPAND_COLLAPSE'
    | 'UIA_SET_VALUE'
    | 'INPUT_CLICK'
    | 'INPUT_TEXT';
  readonly channel: ComputerUseChannel;
  readonly applicationKey: string;
  readonly expectedWindow: {
    readonly handle?: string;
    readonly processId?: number;
    readonly processName?: string;
    readonly title?: string;
  };
  readonly selector?: UiaSelector;
  readonly coordinates?: Readonly<{ x: number; y: number }>;
  readonly targetBounds?: Rectangle;
  readonly windowState?: 'MINIMIZE' | 'MAXIMIZE' | 'RESTORE';
  readonly expandState?: 'EXPAND' | 'COLLAPSE';
  readonly value?: string;
  readonly passwordTargetConfirmedFalse?: true;
  readonly risk: ComputerUseRisk;
  readonly verification: Readonly<{
    kind: 'WINDOW' | 'UIA' | 'VISUAL' | 'SYSTEM';
    expected: string;
  }>;
}

export interface DesktopActionReceipt {
  readonly reference: string;
  readonly changed: boolean;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface DesktopDriver {
  observe(signal: AbortSignal): Promise<DesktopObservation>;
  perform(input: {
    readonly action: DesktopAction;
    readonly target: WindowSnapshot;
    readonly signal: AbortSignal;
  }): Promise<DesktopActionReceipt>;
  verify(input: {
    readonly action: DesktopAction;
    readonly target: WindowSnapshot;
    readonly before: DesktopObservation;
    readonly after: DesktopObservation;
    readonly receipt: DesktopActionReceipt;
    readonly signal: AbortSignal;
  }): Promise<Readonly<{ passed: boolean; evidence: readonly string[]; reason?: string }>>;
}

export interface ApplicationCatalogPort {
  authorize(applicationKey: string, window: WindowSnapshot): Promise<boolean>;
}

export interface ComputerUsePolicyPort {
  evaluate(input: {
    readonly missionId: string;
    readonly action: DesktopAction;
    readonly actionHash: string;
    readonly registryAuthorization?: ToolAuthorization;
  }): Promise<'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | 'REQUIRE_STRONG_APPROVAL'>;
}

export interface ComputerUseAuditPort {
  record(event: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface EmergencyStopPort {
  readonly signal: AbortSignal;
  assertRunning(): void;
}

export class ComputerUseError extends Error {
  constructor(readonly reason: string) {
    super(`Computer Use refused: ${reason}`);
    this.name = 'ComputerUseError';
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

export function hashDesktopAction(missionId: string, action: DesktopAction): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical({ missionId, action })), 'utf8')
    .digest('hex');
}

function validSelector(selector: UiaSelector | undefined): boolean {
  if (!selector) return false;
  return [selector.automationId, selector.name, selector.controlType, selector.className].some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
}

function matchesExpected(
  window: WindowSnapshot,
  expected: DesktopAction['expectedWindow'],
): boolean {
  return (
    (expected.handle === undefined || expected.handle === window.handle) &&
    (expected.processId === undefined || expected.processId === window.processId) &&
    (expected.processName === undefined ||
      expected.processName.toLocaleLowerCase() === window.processName.toLocaleLowerCase()) &&
    (expected.title === undefined || expected.title === window.title)
  );
}

function pointInside(point: Readonly<{ x: number; y: number }>, bounds: Rectangle): boolean {
  return (
    point.x >= bounds.x &&
    point.y >= bounds.y &&
    point.x < bounds.x + bounds.width &&
    point.y < bounds.y + bounds.height
  );
}

export class EmergencyStopLatch {
  private stopped = false;
  private reason = '';
  private controller = new AbortController();

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  stop(reason: string): void {
    this.stopped = true;
    this.reason = reason.trim() || 'emergency_stop';
    this.controller.abort(new ComputerUseError(`emergency_stop:${this.reason}`));
  }

  reset(): void {
    this.stopped = false;
    this.reason = '';
    this.controller = new AbortController();
  }

  assertRunning(): void {
    if (this.stopped) throw new ComputerUseError(`emergency_stop:${this.reason}`);
  }
}

export class UiLeaseManager {
  private lease: Readonly<{ missionId: string; token: string; expiresAt: number }> | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  acquire(missionId: string, ttlMs: number): string {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 300_000) {
      throw new ComputerUseError('invalid_ui_lease_ttl');
    }
    if (this.lease && this.lease.expiresAt > this.now() && this.lease.missionId !== missionId) {
      throw new ComputerUseError('ui_resource_busy');
    }
    const token = createHash('sha256')
      .update(`${missionId}:${this.now()}:${Math.random()}`, 'utf8')
      .digest('hex');
    this.lease = { missionId, token, expiresAt: this.now() + ttlMs };
    return token;
  }

  renew(missionId: string, token: string, ttlMs: number): void {
    if (!this.lease || this.lease.missionId !== missionId || this.lease.token !== token) {
      throw new ComputerUseError('ui_lease_lost');
    }
    this.lease = { ...this.lease, expiresAt: this.now() + ttlMs };
  }

  release(missionId: string, token: string): void {
    if (this.lease?.missionId === missionId && this.lease.token === token) this.lease = undefined;
  }
}

export class ComputerUseCore {
  constructor(
    private readonly driver: DesktopDriver,
    private readonly catalog: ApplicationCatalogPort,
    private readonly policy: ComputerUsePolicyPort,
    private readonly audit: ComputerUseAuditPort,
    private readonly leases: UiLeaseManager,
    private readonly emergencyStop: EmergencyStopPort,
  ) {}

  async execute(input: {
    readonly missionId: string;
    readonly action: DesktopAction;
    readonly approvalActionHash?: string;
    readonly attachedAuthorization?: Readonly<{
      decision: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | 'REQUIRE_STRONG_APPROVAL';
      actionHash: string;
    }>;
    readonly registryAuthorization?: ToolAuthorization;
    readonly signal?: AbortSignal;
    readonly leaseTtlMs?: number;
  }): Promise<
    Readonly<{ actionHash: string; receipt: DesktopActionReceipt; evidence: readonly string[] }>
  > {
    this.validate(input.action);
    this.emergencyStop.assertRunning();
    const callerSignal = input.signal ?? new AbortController().signal;
    const signal = AbortSignal.any([callerSignal, this.emergencyStop.signal]);
    if (signal.aborted) throw new ComputerUseError('action_aborted');
    const actionHash = hashDesktopAction(input.missionId, input.action);
    if (
      input.attachedAuthorization?.actionHash !== undefined &&
      input.attachedAuthorization.actionHash !== actionHash
    ) {
      throw new ComputerUseError('attached_action_hash_mismatch');
    }
    const token = this.leases.acquire(input.missionId, input.leaseTtlMs ?? 30_000);
    try {
      const before = await this.driver.observe(signal);
      const candidates = before.windows.filter((window) =>
        matchesExpected(window, input.action.expectedWindow),
      );
      if (candidates.length !== 1) throw new ComputerUseError('window_target_ambiguous_or_missing');
      const target = candidates[0];
      if (!target || !target.visible || !target.enabled)
        throw new ComputerUseError('window_not_interactive');
      if (!(await this.catalog.authorize(input.action.applicationKey, target))) {
        throw new ComputerUseError('application_not_authorized');
      }
      if (this.requiresForeground(input.action) && before.foregroundHandle !== target.handle) {
        throw new ComputerUseError('unexpected_foreground_window');
      }
      if (input.action.coordinates && !pointInside(input.action.coordinates, target.bounds)) {
        throw new ComputerUseError('coordinates_outside_target');
      }
      const decision = await this.policy.evaluate({
        missionId: input.missionId,
        action: input.action,
        actionHash,
        ...(input.registryAuthorization === undefined
          ? {}
          : { registryAuthorization: input.registryAuthorization }),
      });
      if (decision === 'DENY') throw new ComputerUseError('policy_denied');
      if (input.attachedAuthorization?.decision === 'DENY') {
        throw new ComputerUseError('attached_policy_denied');
      }
      const decisionRank = {
        ALLOW: 0,
        REQUIRE_APPROVAL: 1,
        REQUIRE_STRONG_APPROVAL: 2,
        DENY: 3,
      } as const;
      if (
        input.attachedAuthorization &&
        decisionRank[input.attachedAuthorization.decision] < decisionRank[decision]
      ) {
        throw new ComputerUseError('attached_authorization_too_weak');
      }
      const approvalHash = input.attachedAuthorization?.actionHash ?? input.approvalActionHash;
      if (decision !== 'ALLOW' && approvalHash !== actionHash) {
        throw new ComputerUseError('exact_approval_required');
      }
      this.emergencyStop.assertRunning();
      const receipt = await this.driver.perform({ action: input.action, target, signal });
      this.emergencyStop.assertRunning();
      const after = await this.driver.observe(signal);
      const verification = await this.driver.verify({
        action: input.action,
        target,
        before,
        after,
        receipt,
        signal,
      });
      if (!verification.passed)
        throw new ComputerUseError(verification.reason ?? 'verification_failed');
      await this.audit.record({
        type: 'COMPUTER_USE_ACTION_VERIFIED',
        missionId: input.missionId,
        actionId: input.action.id,
        actionHash,
        channel: input.action.channel,
        applicationKey: input.action.applicationKey,
        targetHandle: target.handle,
        evidence: verification.evidence,
      });
      return { actionHash, receipt, evidence: verification.evidence };
    } catch (error) {
      this.emergencyStop.assertRunning();
      throw error;
    } finally {
      this.leases.release(input.missionId, token);
    }
  }

  private validate(action: DesktopAction): void {
    if (
      !action.id.trim() ||
      !action.applicationKey.trim() ||
      !action.verification.expected.trim()
    ) {
      throw new ComputerUseError('invalid_action');
    }
    const isUia = action.kind.startsWith('UIA_');
    if (isUia && !validSelector(action.selector))
      throw new ComputerUseError('semantic_selector_required');
    if (action.kind === 'INPUT_CLICK' && !action.coordinates) {
      throw new ComputerUseError('click_coordinates_required');
    }
    if (action.kind === 'INPUT_TEXT' && action.value === undefined) {
      throw new ComputerUseError('text_value_required');
    }
    if (action.kind === 'INPUT_TEXT' && action.passwordTargetConfirmedFalse !== true) {
      throw new ComputerUseError('non_password_target_confirmation_required');
    }
    if (action.kind === 'WINDOW_MOVE_RESIZE' && !action.targetBounds) {
      throw new ComputerUseError('target_bounds_required');
    }
    if (action.kind === 'WINDOW_STATE' && !action.windowState) {
      throw new ComputerUseError('window_state_required');
    }
    if (action.kind === 'UIA_EXPAND_COLLAPSE' && !action.expandState) {
      throw new ComputerUseError('expand_state_required');
    }
    if (action.channel === 'VISION_INPUT' && !['INPUT_CLICK', 'INPUT_TEXT'].includes(action.kind)) {
      throw new ComputerUseError('invalid_vision_input_action');
    }
  }

  private requiresForeground(action: DesktopAction): boolean {
    return action.kind.startsWith('UIA_') || action.kind.startsWith('INPUT_');
  }
}
