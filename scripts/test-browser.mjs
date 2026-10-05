import assert from 'node:assert/strict';
import console from 'node:console';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ControlledBrowserService,
  PlaywrightChromeDriver,
} from '../apps/desktop-agent/dist/index.js';

const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

let chromeExecutable;
for (const candidate of chromeCandidates) {
  try {
    await access(candidate);
    chromeExecutable = candidate;
    break;
  } catch {
    // Continue with the next explicit Windows installation path.
  }
}
if (!chromeExecutable) throw new Error('Chrome or Edge is required for the browser smoke test');

const root = await mkdtemp(join(tmpdir(), 'arcc-browser-smoke-'));
const profileRoot = join(root, 'profiles');
const profile = join(profileRoot, 'smoke');
const allowedDomains = new Set(['example.com']);
const driver = new PlaywrightChromeDriver({
  chromeExecutable,
  allowedDomains,
  downloadsDirectory: join(root, 'downloads'),
  quarantineDirectory: join(root, 'quarantine'),
  evidenceDirectory: join(root, 'evidence'),
  headless: true,
});
const events = [];
const browser = new ControlledBrowserService(
  profile,
  profileRoot,
  allowedDomains,
  driver,
  {
    authorize: async ({ actionHash }) => ({ approved: true, pinVerified: true, actionHash }),
  },
  { record: async (event) => events.push(event) },
);

try {
  const result = await browser.execute({ action: 'READ', url: 'https://example.com/' });
  assert.equal(result.trust, 'DATA_ONLY');
  assert.equal(result.classification, 'LOCAL_ONLY');
  assert.match(result.text ?? '', /(?:Example Domain|documentation examples)/u);
  assert.equal(events.length, 1);
  console.log('Browser smoke test passed with an isolated temporary profile.');
} finally {
  await browser.close();
  const resolved = root.toLowerCase();
  assert.ok(resolved.startsWith(tmpdir().toLowerCase()));
  assert.match(resolved, /arcc-browser-smoke-/u);
  await rm(root, { recursive: true, force: true });
}
