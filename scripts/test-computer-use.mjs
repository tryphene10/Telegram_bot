import { spawn } from 'node:child_process';
import console from 'node:console';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ComputerUseCore,
  EmergencyStopLatch,
  ManagedApplicationCatalog,
  UiLeaseManager,
  WindowsDesktopDriver,
  WindowsScreenshotProvider,
  WindowsProcessIdentityProvider,
  WindowsUiaDriver,
  WindowsWindowController,
  WindowsWindowObserver,
} from '../apps/desktop-agent/dist/index.js';

const fixturePath = resolve('scripts/fixtures/computer-use-fixture.ps1');
const fixture = spawn(
  'powershell.exe',
  ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fixturePath],
  // The fixture's top-level WinForms window must remain visible to EnumWindows/UIA.
  { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] },
);
let screenshotDirectory;
let fixtureOutput = '';
fixture.stdout.on('data', (chunk) => {
  fixtureOutput += chunk.toString();
});
fixture.stderr.on('data', (chunk) => {
  fixtureOutput += chunk.toString();
});

async function findFixture(observer) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (fixture.exitCode !== null) {
      throw new Error(`fixture_exited_${fixture.exitCode}: ${fixtureOutput.trim() || 'no_output'}`);
    }
    const observation = await observer.observe();
    const window = observation.windows.find(({ title }) => title === 'ARCC Computer Use Fixture');
    if (window) return window;
    await delay(125);
  }
  throw new Error(`fixture_window_not_found: ${fixtureOutput.trim() || 'process_still_running'}`);
}

try {
  const observer = new WindowsWindowObserver();
  const uia = new WindowsUiaDriver();
  const controller = new WindowsWindowController();
  const window = await findFixture(observer);
  await controller.perform({ handle: window.handle, operation: 'ACTIVATE' });
  await delay(150);

  const treeBefore = await uia.inspect(window.handle);
  if (
    !treeBefore.elements.some(
      ({ name, controlType }) => name === 'Apply' && controlType === 'Button',
    )
  ) {
    throw new Error(
      `fixture_button_not_discovered: ${JSON.stringify(
        treeBefore.elements.map(({ name, automationId, className, controlType }) => ({
          name,
          automationId,
          className,
          controlType,
        })),
      )}`,
    );
  }

  const identityProvider = new WindowsProcessIdentityProvider();
  const fixtureIdentity = await identityProvider.inspect(window.processId, true);
  if (!fixtureIdentity?.executableSha256) throw new Error('fixture_identity_not_verified');
  const catalog = new ManagedApplicationCatalog(
    {
      findEnabled: async (applicationKey) =>
        applicationKey === 'arcc-fixture'
          ? {
              appKey: applicationKey,
              executablePath: fixtureIdentity.executablePath,
              executableSha256: fixtureIdentity.executableSha256,
              launchProfile: { windowTitles: ['ARCC Computer Use Fixture'] },
            }
          : undefined,
    },
    identityProvider,
  );

  const core = new ComputerUseCore(
    new WindowsDesktopDriver(observer, uia, controller),
    catalog,
    { evaluate: async () => 'ALLOW' },
    { record: async () => undefined },
    new UiLeaseManager(),
    new EmergencyStopLatch(),
  );
  const result = await core.execute({
    missionId: 'computer-use-smoke',
    action: {
      id: 'invoke-apply',
      kind: 'UIA_INVOKE',
      channel: 'UIA',
      applicationKey: 'arcc-fixture',
      expectedWindow: { handle: window.handle, processId: window.processId },
      selector: { name: 'Apply', controlType: 'Button' },
      risk: 'MEDIUM',
      verification: { kind: 'UIA', expected: 'status=APPLIED' },
    },
  });
  await delay(150);
  const treeAfter = await uia.inspect(window.handle);
  const applied = treeAfter.elements.some(({ name }) => name === 'APPLIED');
  if (!applied) throw new Error('fixture_result_not_verified');

  screenshotDirectory = await mkdtemp(join(tmpdir(), 'arcc-computer-use-'));
  const imagePath = join(screenshotDirectory, 'fixture.png');
  const previewPath = join(screenshotDirectory, 'fixture.preview.jpg');
  await new WindowsScreenshotProvider().capture({
    imagePath,
    previewPath,
    target: {
      kind: 'WINDOW',
      windowHandle: window.handle,
      expectedBounds: window.bounds,
    },
    masks: [],
    annotations: [
      {
        x: 25,
        y: 70,
        width: 140,
        height: 60,
        marker: 'ACTION_TARGET',
      },
    ],
    previewMaxWidth: 640,
    previewMaxHeight: 360,
    jpegQuality: 60,
  });
  const png = await readFile(imagePath);
  const capturedWidth = png.readUInt32BE(16);
  const capturedHeight = png.readUInt32BE(20);
  if (capturedWidth !== window.bounds.width || capturedHeight !== window.bounds.height) {
    throw new Error('fixture_targeted_capture_dimensions_mismatch');
  }
  console.log(
    JSON.stringify({
      windowHandle: window.handle,
      discoveredElements: treeBefore.elements.length,
      actionHashLength: result.actionHash.length,
      evidenceCount: result.evidence.length,
      applied,
      capturedDimensions: `${capturedWidth}x${capturedHeight}`,
      catalogIdentityVerified: true,
    }),
  );
} finally {
  fixture.kill();
  if (screenshotDirectory) await rm(screenshotDirectory, { recursive: true, force: true });
}
