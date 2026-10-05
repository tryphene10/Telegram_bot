import type {
  DesktopAction,
  DesktopActionReceipt,
  DesktopDriver,
  DesktopObservation,
  WindowSnapshot,
} from './computer-use-core.js';
import { WindowsInputDriver } from './windows-input-driver.js';
import { WindowsUiaDriver, resolveUniqueUiaElement, type UiaOperation } from './windows-uia.js';
import { WindowsWindowController, type WindowOperation } from './windows-window-controller.js';
import { WindowsWindowObserver } from './windows-window-observer.js';

export class WindowsDesktopDriver implements DesktopDriver {
  constructor(
    private readonly observer = new WindowsWindowObserver(),
    private readonly uia = new WindowsUiaDriver(),
    private readonly windows = new WindowsWindowController(),
    private readonly input = new WindowsInputDriver(),
  ) {}

  observe(signal: AbortSignal): Promise<DesktopObservation> {
    return this.observer.observe(signal);
  }

  async perform(input: {
    readonly action: DesktopAction;
    readonly target: WindowSnapshot;
    readonly signal: AbortSignal;
  }): Promise<DesktopActionReceipt> {
    const { action, target, signal } = input;
    if (action.kind.startsWith('WINDOW_')) {
      const operation = this.windowOperation(action);
      const result = await this.windows.perform({
        handle: target.handle,
        operation,
        ...(action.targetBounds ? { bounds: action.targetBounds } : {}),
        signal,
      });
      return { reference: `window:${action.id}`, changed: true, detail: result };
    }
    if (action.kind.startsWith('UIA_')) {
      if (!action.selector) throw new Error('semantic_selector_required');
      const result = await this.uia.perform({
        windowHandle: target.handle,
        selector: action.selector,
        operation: this.uiaOperation(action),
        ...(action.value === undefined ? {} : { value: action.value }),
        signal,
      });
      return { reference: `uia:${action.id}`, changed: true, detail: result };
    }
    if (action.kind === 'INPUT_CLICK') {
      if (!action.coordinates) throw new Error('click_coordinates_required');
      const result = await this.input.perform(
        {
          kind: 'CLICK',
          windowHandle: target.handle,
          expectedBounds: target.bounds,
          point: action.coordinates,
        },
        signal,
      );
      return { reference: `input:${action.id}`, changed: true, detail: result };
    }
    if (!action.selector || action.value === undefined) {
      throw new Error('text_target_and_value_required');
    }
    const tree = await this.uia.inspect(target.handle, signal);
    const element = resolveUniqueUiaElement(tree, action.selector);
    if (element.password) throw new Error('password_target_refused');
    const result = await this.input.perform(
      {
        kind: 'TYPE_TEXT',
        windowHandle: target.handle,
        expectedBounds: target.bounds,
        text: action.value,
        passwordTargetConfirmedFalse: true,
      },
      signal,
    );
    return { reference: `input:${action.id}`, changed: true, detail: result };
  }

  async verify(input: {
    readonly action: DesktopAction;
    readonly target: WindowSnapshot;
    readonly before: DesktopObservation;
    readonly after: DesktopObservation;
    readonly receipt: DesktopActionReceipt;
    readonly signal: AbortSignal;
  }): Promise<Readonly<{ passed: boolean; evidence: readonly string[]; reason?: string }>> {
    const afterTarget = input.after.windows.find(({ handle }) => handle === input.target.handle);
    if (!afterTarget) return { passed: false, evidence: [], reason: 'target_window_disappeared' };
    if (input.action.kind === 'WINDOW_ACTIVATE' && !afterTarget.foreground) {
      return { passed: false, evidence: [], reason: 'window_not_foreground' };
    }
    if (
      input.action.kind === 'WINDOW_MOVE_RESIZE' &&
      input.action.targetBounds &&
      JSON.stringify(afterTarget.bounds) !== JSON.stringify(input.action.targetBounds)
    ) {
      return { passed: false, evidence: [], reason: 'window_bounds_not_applied' };
    }
    if (input.action.kind.startsWith('UIA_')) {
      if (!input.action.selector)
        return { passed: false, evidence: [], reason: 'selector_missing' };
      try {
        const tree = await this.uia.inspect(input.target.handle, input.signal);
        resolveUniqueUiaElement(tree, input.action.selector);
      } catch {
        return { passed: false, evidence: [], reason: 'uia_target_not_verifiable' };
      }
    }
    if (input.action.kind.startsWith('INPUT_') && !afterTarget.foreground) {
      return { passed: false, evidence: [], reason: 'foreground_changed_after_input' };
    }
    return {
      passed: input.receipt.changed,
      evidence: [
        `receipt:${input.receipt.reference}`,
        `window:${afterTarget.handle}`,
        `verification:${input.action.verification.kind}:${input.action.verification.expected}`,
      ],
    };
  }

  private windowOperation(action: DesktopAction): WindowOperation {
    if (action.kind === 'WINDOW_ACTIVATE') return 'ACTIVATE';
    if (action.kind === 'WINDOW_MOVE_RESIZE') return 'MOVE_RESIZE';
    if (action.kind === 'WINDOW_STATE' && action.windowState) return action.windowState;
    throw new Error('invalid_window_operation');
  }

  private uiaOperation(action: DesktopAction): UiaOperation {
    const operations: Partial<Record<DesktopAction['kind'], UiaOperation>> = {
      UIA_INVOKE: 'INVOKE',
      UIA_SELECT: 'SELECT',
      UIA_TOGGLE: 'TOGGLE',
      UIA_SET_VALUE: 'SET_VALUE',
    };
    if (action.kind === 'UIA_EXPAND_COLLAPSE' && action.expandState) return action.expandState;
    const operation = operations[action.kind];
    if (!operation) throw new Error('invalid_uia_operation');
    return operation;
  }
}
