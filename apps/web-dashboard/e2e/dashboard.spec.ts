import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
const qa = process.env.ARCC_QA_DIR ?? join(process.cwd(), '../../docs/qa/phase-18/renditions');
test.beforeAll(async () => {
  await mkdir(qa, { recursive: true });
});
test('overview, mission creation and strong approval are interactive', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
  });
  await page.goto('/?demo=1');
  await expect(page).toHaveTitle('ARCC · Command Center');
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble' })).toBeVisible();
  await expect(page.getByText('Audit sécurité poste').first()).toBeVisible();
  await page.getByRole('button', { name: /Redémarrer le service PostgreSQL/u }).click();
  await expect(page.getByRole('dialog', { name: 'Approbation forte requise' })).toBeVisible();
  await expect(page.getByLabel('PIN local')).toBeFocused();
  if (qa && testInfo.project.name === 'desktop')
    await page.screenshot({ path: join(qa, 'dashboard-approval-desktop.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Nouvelle mission' }).click();
  await expect(page.getByRole('dialog', { name: 'Nouvelle mission' })).toBeVisible();
  await page.getByLabel('Objectif').fill('Vérifier les services locaux');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('responsive overview keeps critical actions without horizontal overflow', async ({
  page,
}, testInfo) => {
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await expect(page.getByRole('button', { name: 'Nouvelle mission' })).toBeVisible();
  await expect(page.getByText('Approbations en attente')).toBeVisible();
  if (qa)
    await page.screenshot({
      path: join(qa, `dashboard-overview-${testInfo.project.name}.png`),
      fullPage: false,
    });
});
test('project route and compact navigation render meaningful content', async ({ page }) => {
  await page.goto('/projects?demo=1');
  await expect(page.getByRole('heading', { name: 'Projets' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Command Center stack/u })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});
test('artifact route and theme control remain operational', async ({ page }) => {
  await page.goto('/artifacts?demo=1');
  await expect(page.getByRole('heading', { name: 'Artefacts' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Rapport sécurité poste/u })).toBeVisible();
  await page.getByRole('button', { name: 'Activer le thème clair' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});
test('sanitized diagnostic and keyboard shortcuts are available', async ({ page }) => {
  await page.goto('/diagnostic?demo=1');
  await expect(page.getByRole('heading', { name: 'Diagnostic' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Exporter/u })).toBeEnabled();
  await page.keyboard.press('Alt+m');
  await expect(page).toHaveURL(/\/missions$/u);
  await expect(page.getByRole('heading', { name: 'Missions' })).toBeVisible();
});
