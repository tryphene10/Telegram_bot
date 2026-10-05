import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { UiaSelector } from './computer-use-core.js';

const execFileAsync = promisify(execFile);

export interface UiaElementSnapshot {
  readonly name: string;
  readonly automationId: string;
  readonly className: string;
  readonly controlType: string;
  readonly enabled: boolean;
  readonly offscreen: boolean;
  readonly password: boolean;
  readonly bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
}

export interface UiaTreeSnapshot {
  readonly windowHandle: string;
  readonly capturedAt: string;
  readonly truncated: boolean;
  readonly elements: readonly UiaElementSnapshot[];
  readonly classification: 'LOCAL_ONLY';
  readonly trust: 'DATA_ONLY';
}

export type UiaOperation = 'INVOKE' | 'SELECT' | 'TOGGLE' | 'EXPAND' | 'COLLAPSE' | 'SET_VALUE';

export class WindowsUiaError extends Error {
  constructor(readonly reason: string) {
    super(`Windows UIA error: ${reason}`);
    this.name = 'WindowsUiaError';
  }
}

function encodedJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export function buildUiaInspectionScript(
  windowHandle: string,
  maximumDepth = 8,
  maximumNodes = 500,
): string {
  if (!/^\d+$/u.test(windowHandle)) throw new WindowsUiaError('invalid_window_handle');
  if (!Number.isSafeInteger(maximumDepth) || maximumDepth < 1 || maximumDepth > 20) {
    throw new WindowsUiaError('invalid_maximum_depth');
  }
  if (!Number.isSafeInteger(maximumNodes) || maximumNodes < 1 || maximumNodes > 2_000) {
    throw new WindowsUiaError('invalid_maximum_nodes');
  }
  return String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new(${windowHandle}))
if($null -eq $root){ throw 'uia_root_not_found' }
$queue=New-Object System.Collections.Queue
$queue.Enqueue([pscustomobject]@{ element=$root; depth=0 })
$items=New-Object System.Collections.ArrayList
$walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
$truncated=$false
while($queue.Count -gt 0){
  $entry=$queue.Dequeue()
  $element=$entry.element
  try {
    $rect=$element.Current.BoundingRectangle
    [void]$items.Add([pscustomobject]@{
      name=$element.Current.Name
      automationId=$element.Current.AutomationId
      className=$element.Current.ClassName
      controlType=$element.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
      enabled=$element.Current.IsEnabled
      offscreen=$element.Current.IsOffscreen
      password=$element.Current.IsPassword
      x=[int]$rect.X
      y=[int]$rect.Y
      width=[int]$rect.Width
      height=[int]$rect.Height
    })
  } catch { continue }
  if($items.Count -ge ${maximumNodes}){ $truncated=$true; break }
  if($entry.depth -ge ${maximumDepth}){ continue }
  $child=$walker.GetFirstChild($element)
  while($null -ne $child){
    $queue.Enqueue([pscustomobject]@{ element=$child; depth=$entry.depth+1 })
    $child=$walker.GetNextSibling($child)
  }
}
[pscustomobject]@{ truncated=$truncated; elements=$items.ToArray() } | ConvertTo-Json -Compress -Depth 5
`.trim();
}

export function buildUiaActionScript(input: {
  readonly windowHandle: string;
  readonly selector: UiaSelector;
  readonly operation: UiaOperation;
  readonly value?: string;
}): string {
  if (!/^\d+$/u.test(input.windowHandle)) throw new WindowsUiaError('invalid_window_handle');
  if (
    ![
      input.selector.automationId,
      input.selector.name,
      input.selector.controlType,
      input.selector.className,
    ].some((value) => typeof value === 'string' && value.trim())
  ) {
    throw new WindowsUiaError('semantic_selector_required');
  }
  if (input.operation === 'SET_VALUE' && input.value === undefined) {
    throw new WindowsUiaError('value_required');
  }
  const payload = encodedJson({
    selector: input.selector,
    operation: input.operation,
    value: input.value,
  });
  return String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$payloadJson=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$payload=$payloadJson | ConvertFrom-Json
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new(${input.windowHandle}))
if($null -eq $root){ throw 'uia_root_not_found' }
$all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$matches=New-Object System.Collections.ArrayList
foreach($element in $all){
  try {
    $ok=$true
    if($payload.selector.automationId -and $element.Current.AutomationId -ne $payload.selector.automationId){$ok=$false}
    if($payload.selector.name -and $element.Current.Name -ne $payload.selector.name){$ok=$false}
    if($payload.selector.className -and $element.Current.ClassName -ne $payload.selector.className){$ok=$false}
    if($payload.selector.controlType -and $element.Current.ControlType.ProgrammaticName.Replace('ControlType.','') -ne $payload.selector.controlType){$ok=$false}
    if($ok){[void]$matches.Add($element)}
  } catch {}
}
if($matches.Count -ne 1){ throw ('uia_match_count_'+$matches.Count) }
$target=$matches[0]
if(-not $target.Current.IsEnabled -or $target.Current.IsOffscreen){ throw 'uia_target_not_interactive' }
if($payload.operation -eq 'SET_VALUE' -and $target.Current.IsPassword){ throw 'uia_password_field_refused' }
$pattern=$null
switch($payload.operation){
  'INVOKE' {
    if($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){
      ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
    } else { throw 'uia_pattern_unavailable' }
  }
  'SELECT' { if(-not $target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)){throw 'uia_pattern_unavailable'}; ([System.Windows.Automation.SelectionItemPattern]$pattern).Select() }
  'TOGGLE' { if(-not $target.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)){throw 'uia_pattern_unavailable'}; ([System.Windows.Automation.TogglePattern]$pattern).Toggle() }
  'EXPAND' { if(-not $target.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)){throw 'uia_pattern_unavailable'}; ([System.Windows.Automation.ExpandCollapsePattern]$pattern).Expand() }
  'COLLAPSE' { if(-not $target.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)){throw 'uia_pattern_unavailable'}; ([System.Windows.Automation.ExpandCollapsePattern]$pattern).Collapse() }
  'SET_VALUE' { if(-not $target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){throw 'uia_pattern_unavailable'}; ([System.Windows.Automation.ValuePattern]$pattern).SetValue([string]$payload.value) }
  default { throw 'uia_operation_not_allowed' }
}
[pscustomobject]@{ success=$true; operation=$payload.operation; matchCount=1 } | ConvertTo-Json -Compress
`.trim();
}

interface RawElement {
  name: unknown;
  automationId: unknown;
  className: unknown;
  controlType: unknown;
  enabled: unknown;
  offscreen: unknown;
  password: unknown;
  x: unknown;
  y: unknown;
  width: unknown;
  height: unknown;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new WindowsUiaError('invalid_bounds');
  return Math.trunc(value);
}

export function parseUiaTree(
  raw: string,
  windowHandle: string,
  capturedAt: string,
): UiaTreeSnapshot {
  const parsed = JSON.parse(raw) as { truncated?: unknown; elements?: readonly RawElement[] };
  const elements = (parsed.elements ?? []).map((element) => ({
    name: String(element.name ?? ''),
    automationId: String(element.automationId ?? ''),
    className: String(element.className ?? ''),
    controlType: String(element.controlType ?? ''),
    enabled: element.enabled === true,
    offscreen: element.offscreen === true,
    password: element.password === true,
    bounds: {
      x: number(element.x),
      y: number(element.y),
      width: number(element.width),
      height: number(element.height),
    },
  }));
  return {
    windowHandle,
    capturedAt,
    truncated: parsed.truncated === true,
    elements,
    classification: 'LOCAL_ONLY',
    trust: 'DATA_ONLY',
  };
}

export function resolveUniqueUiaElement(
  tree: UiaTreeSnapshot,
  selector: UiaSelector,
): UiaElementSnapshot {
  const fields = [selector.automationId, selector.name, selector.controlType, selector.className];
  if (!fields.some((value) => typeof value === 'string' && value.trim())) {
    throw new WindowsUiaError('semantic_selector_required');
  }
  const matches = tree.elements.filter(
    (element) =>
      (selector.automationId === undefined || element.automationId === selector.automationId) &&
      (selector.name === undefined || element.name === selector.name) &&
      (selector.controlType === undefined || element.controlType === selector.controlType) &&
      (selector.className === undefined || element.className === selector.className),
  );
  if (matches.length !== 1) throw new WindowsUiaError(`match_count_${matches.length}`);
  const match = matches[0];
  if (!match) throw new WindowsUiaError('match_missing');
  if (!match.enabled || match.offscreen) throw new WindowsUiaError('target_not_interactive');
  return match;
}

export class WindowsUiaDriver {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async inspect(windowHandle: string, signal?: AbortSignal): Promise<UiaTreeSnapshot> {
    const stdout = await this.run(buildUiaInspectionScript(windowHandle), signal);
    return parseUiaTree(stdout, windowHandle, this.now().toISOString());
  }

  async perform(input: {
    readonly windowHandle: string;
    readonly selector: UiaSelector;
    readonly operation: UiaOperation;
    readonly value?: string;
    readonly signal?: AbortSignal;
  }): Promise<Readonly<{ success: true; operation: UiaOperation; matchCount: 1 }>> {
    const stdout = await this.run(buildUiaActionScript(input), input.signal);
    const result = JSON.parse(stdout) as {
      success?: unknown;
      operation?: unknown;
      matchCount?: unknown;
    };
    if (
      result.success !== true ||
      result.operation !== input.operation ||
      result.matchCount !== 1
    ) {
      throw new WindowsUiaError('invalid_action_receipt');
    }
    return { success: true, operation: input.operation, matchCount: 1 };
  }

  private async run(script: string, signal?: AbortSignal): Promise<string> {
    if (process.platform !== 'win32') throw new WindowsUiaError('windows_only');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const { stdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024, signal },
        );
        return stdout.trim();
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' || attempt === 2 || signal?.aborted) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    throw new WindowsUiaError('process_start_failed');
  }
}
