import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import { FileTransferGuard, type ProjectManifest, type TransferMetadata } from '@arcc/tools';
import type { ToolAuthorization } from '@arcc/tools';

export type BrowserAction =
  | 'OPEN'
  | 'READ'
  | 'EXTRACT'
  | 'DOWNLOAD'
  | 'UPLOAD'
  | 'FORM'
  | 'CLICK'
  | 'SEND'
  | 'PAY'
  | 'DELETE'
  | 'PUBLISH'
  | 'SENSITIVE_LOGIN';
const STRONG = new Set<BrowserAction>([
  'UPLOAD',
  'SEND',
  'PAY',
  'DELETE',
  'PUBLISH',
  'SENSITIVE_LOGIN',
]);

export interface BrowserDriver {
  start(input: { readonly profileDirectory: string }): Promise<void>;
  prepare(url: string): Promise<void>;
  act(input: {
    readonly action: BrowserAction;
    readonly url: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  }): Promise<{
    readonly text?: string;
    readonly download?: TransferMetadata & { readonly temporaryPath: string };
    readonly challenge?: 'CAPTCHA' | 'MFA';
  }>;
  screenshot(label: 'BEFORE' | 'AFTER'): Promise<string>;
  quarantine(path: string, reason: string): Promise<void>;
  close?(): Promise<void>;
}

export interface BrowserApprovalPort {
  authorize(input: {
    readonly action: BrowserAction;
    readonly actionHash: string;
    readonly url: string;
    readonly registryAuthorization?: ToolAuthorization;
  }): Promise<{
    readonly approved: boolean;
    readonly pinVerified: boolean;
    readonly actionHash: string;
  }>;
}

export interface BrowserAuditPort {
  record(input: {
    readonly url: string;
    readonly action: BrowserAction;
    readonly result: string;
    readonly before?: string;
    readonly after?: string;
  }): Promise<void>;
}

export class BrowserDeniedError extends Error {
  constructor(readonly reason: string) {
    super(`Browser denied: ${reason}`);
    this.name = 'BrowserDeniedError';
  }
}

function hashAction(
  action: BrowserAction,
  url: string,
  parameters: Readonly<Record<string, unknown>>,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ action, url, parameters }), 'utf8')
    .digest('hex');
}

export class ControlledBrowserService {
  private started = false;
  constructor(
    private readonly profileDirectory: string,
    dedicatedRoot: string,
    private readonly allowedDomains: ReadonlySet<string>,
    private readonly driver: BrowserDriver,
    private readonly approvals: BrowserApprovalPort,
    private readonly audit: BrowserAuditPort,
    private readonly transfers = new FileTransferGuard(),
  ) {
    const profile = win32.resolve(profileDirectory).toLowerCase();
    const root = `${win32.resolve(dedicatedRoot).toLowerCase()}\\`;
    if (
      !profile.startsWith(root) ||
      /\\(?:google\\chrome|microsoft\\edge)\\user data(?:\\|$)/u.test(profile)
    )
      throw new BrowserDeniedError('personal_profile_forbidden');
  }

  async execute(input: {
    readonly action: BrowserAction;
    readonly url: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
    readonly manifest?: ProjectManifest;
    readonly downloadDestination?: string;
    readonly maximumDownloadBytes?: number;
    readonly registryAuthorization?: ToolAuthorization;
  }): Promise<{
    readonly trust: 'DATA_ONLY';
    readonly classification: 'LOCAL_ONLY';
    readonly text?: string;
    readonly downloadPath?: string;
  }> {
    const url = this.authorizedUrl(input.url);
    const parameters = input.parameters ?? {};
    const actionHash = hashAction(input.action, url.href, parameters);
    if (STRONG.has(input.action)) {
      if (input.action === 'PAY') throw new BrowserDeniedError('autonomous_payment_forbidden');
      const approval = await this.approvals.authorize({
        action: input.action,
        actionHash,
        url: url.href,
        ...(input.registryAuthorization === undefined
          ? {}
          : { registryAuthorization: input.registryAuthorization }),
      });
      if (!approval.approved || !approval.pinVerified || approval.actionHash !== actionHash)
        throw new BrowserDeniedError('strong_approval_required');
    }
    if (!this.started) {
      await this.driver.start({ profileDirectory: this.profileDirectory });
      this.started = true;
    }
    await this.driver.prepare(url.href);
    const mutating = !['OPEN', 'READ', 'EXTRACT'].includes(input.action);
    const before = mutating ? await this.driver.screenshot('BEFORE') : undefined;
    const result = await this.driver.act({ action: input.action, url: url.href, parameters });
    if (result.challenge)
      throw new BrowserDeniedError(`manual_${result.challenge.toLowerCase()}_required`);
    let downloadPath: string | undefined;
    if (result.download) {
      try {
        if (!input.manifest || !input.downloadDestination || !input.maximumDownloadBytes)
          throw new BrowserDeniedError('download_policy_required');
        downloadPath = (
          await this.transfers.validate(
            input.manifest,
            result.download,
            input.downloadDestination,
            input.maximumDownloadBytes,
          )
        ).canonicalPath;
      } catch (error) {
        await this.driver.quarantine(
          result.download.temporaryPath,
          error instanceof Error ? error.message : 'download_denied',
        );
        throw error;
      }
    }
    const after = mutating ? await this.driver.screenshot('AFTER') : undefined;
    await this.audit.record({
      url: `${url.origin}${url.pathname}`,
      action: input.action,
      result: 'COMPLETED',
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    });
    return {
      trust: 'DATA_ONLY',
      classification: 'LOCAL_ONLY',
      ...(result.text ? { text: result.text } : {}),
      ...(downloadPath ? { downloadPath } : {}),
    };
  }

  async close(): Promise<void> {
    await this.driver.close?.();
    this.started = false;
  }

  private authorizedUrl(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BrowserDeniedError('invalid_url');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !this.allowedDomains.has(url.hostname.toLowerCase())
    )
      throw new BrowserDeniedError('domain_not_allowlisted');
    return url;
  }
}
