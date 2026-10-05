import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { BrowserAction, BrowserDriver } from './browser-service.js';

export interface PlaywrightBrowserDriverOptions {
  readonly chromeExecutable: string;
  readonly allowedDomains: ReadonlySet<string>;
  readonly downloadsDirectory: string;
  readonly quarantineDirectory: string;
  readonly evidenceDirectory: string;
  readonly headless?: boolean;
  readonly timeoutMs?: number;
  readonly maximumExtractCharacters?: number;
}

function requiredString(parameters: Readonly<Record<string, unknown>>, key: string): string {
  const value = parameters[key];
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`browser_parameter_${key}_required`);
  return value;
}

function mimeFromName(name: string): string {
  return (
    (
      {
        '.pdf': 'application/pdf',
        '.zip': 'application/zip',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.md': 'text/plain',
        '.txt': 'text/plain',
        '.log': 'text/plain',
      } as Record<string, string>
    )[extname(name).toLowerCase()] ?? 'application/octet-stream'
  );
}

export class PlaywrightChromeDriver implements BrowserDriver {
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  constructor(private readonly options: PlaywrightBrowserDriverOptions) {}

  async start(input: { readonly profileDirectory: string }): Promise<void> {
    if (this.context) return;
    await Promise.all([
      mkdir(input.profileDirectory, { recursive: true }),
      mkdir(this.options.downloadsDirectory, { recursive: true }),
      mkdir(this.options.quarantineDirectory, { recursive: true }),
      mkdir(this.options.evidenceDirectory, { recursive: true }),
    ]);
    this.context = await chromium.launchPersistentContext(input.profileDirectory, {
      executablePath: this.options.chromeExecutable,
      headless: this.options.headless ?? true,
      acceptDownloads: true,
      downloadsPath: this.options.downloadsDirectory,
      serviceWorkers: 'block',
      permissions: [],
    });
    this.context.setDefaultTimeout(this.options.timeoutMs ?? 15_000);
    await this.context.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (
        ['data:', 'blob:', 'about:', 'chrome-extension:'].includes(requestUrl.protocol) ||
        (requestUrl.protocol === 'https:' &&
          this.options.allowedDomains.has(requestUrl.hostname.toLowerCase()))
      ) {
        await route.continue();
      } else await route.abort('blockedbyclient');
    });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
  }

  async prepare(url: string): Promise<void> {
    const page = this.requirePage();
    if (page.url() !== url) await page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async act(input: {
    readonly action: BrowserAction;
    readonly url: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  }): Promise<{
    readonly text?: string;
    readonly download?: {
      readonly fileName: string;
      readonly mimeType: string;
      readonly sizeBytes: number;
      readonly firstBytes: Uint8Array;
      readonly temporaryPath: string;
    };
    readonly challenge?: 'CAPTCHA' | 'MFA';
  }> {
    const page = this.requirePage();
    let text: string | undefined;
    let download: Awaited<ReturnType<PlaywrightChromeDriver['download']>> | undefined;
    if (input.action === 'OPEN') text = await page.title();
    else if (input.action === 'READ') text = await page.locator('body').innerText();
    else if (input.action === 'EXTRACT')
      text = await page.locator(requiredString(input.parameters, 'selector')).innerText();
    else if (input.action === 'DOWNLOAD')
      download = await this.download(page, requiredString(input.parameters, 'selector'));
    else if (input.action === 'UPLOAD') {
      await page
        .locator(requiredString(input.parameters, 'selector'))
        .setInputFiles(requiredString(input.parameters, 'filePath'));
    } else if (input.action === 'FORM' || input.action === 'SENSITIVE_LOGIN') {
      const fields = input.parameters.fields;
      if (typeof fields !== 'object' || fields === null || Array.isArray(fields))
        throw new Error('browser_parameter_fields_required');
      for (const [selector, value] of Object.entries(fields)) {
        if (typeof value !== 'string') throw new Error('browser_field_value_invalid');
        await page.locator(selector).fill(value);
      }
      if (typeof input.parameters.submitSelector === 'string')
        await page.locator(input.parameters.submitSelector).click();
    } else {
      await page.locator(requiredString(input.parameters, 'selector')).click();
    }
    const challenge = await this.challenge(page);
    const limit = this.options.maximumExtractCharacters ?? 200_000;
    return {
      ...(text === undefined ? {} : { text: text.slice(0, limit) }),
      ...(download === undefined ? {} : { download }),
      ...(challenge === undefined ? {} : { challenge }),
    };
  }

  async screenshot(label: 'BEFORE' | 'AFTER'): Promise<string> {
    const path = join(
      this.options.evidenceDirectory,
      `${Date.now()}-${randomUUID()}-${label.toLowerCase()}.png`,
    );
    await this.requirePage().screenshot({ path, fullPage: true });
    return path;
  }

  async quarantine(path: string, reason: string): Promise<void> {
    const safeReason = reason.replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 40);
    await mkdir(this.options.quarantineDirectory, { recursive: true });
    await rename(
      path,
      join(this.options.quarantineDirectory, `${randomUUID()}-${safeReason}.quarantine`),
    );
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
  }

  private async download(page: Page, selector: string) {
    const event = page.waitForEvent('download');
    await page.locator(selector).click();
    const item = await event;
    const fileName = item.suggestedFilename();
    const temporaryPath = join(this.options.downloadsDirectory, `${randomUUID()}-${fileName}`);
    await item.saveAs(temporaryPath);
    const [bytes, metadata] = await Promise.all([readFile(temporaryPath), stat(temporaryPath)]);
    return {
      fileName,
      mimeType: mimeFromName(fileName),
      sizeBytes: metadata.size,
      firstBytes: bytes.subarray(0, 512),
      temporaryPath,
    };
  }

  private async challenge(page: Page): Promise<'CAPTCHA' | 'MFA' | undefined> {
    if ((await page.locator('iframe[src*="captcha" i], [class*="captcha" i]').count()) > 0)
      return 'CAPTCHA';
    if (
      (await page.locator('input[autocomplete="one-time-code"], input[name*="otp" i]').count()) > 0
    )
      return 'MFA';
    return undefined;
  }

  private requirePage(): Page {
    if (!this.page) throw new Error('browser_not_started');
    return this.page;
  }
}
