// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App.js';
import { overviewFixture } from './demo-data.js';
afterEach(() => cleanup());
function view() {
  document.documentElement.lang = 'fr';
  document.title = 'ARCC · Command Center';
  return render(
    <MemoryRouter>
      <App initialData={overviewFixture} />
    </MemoryRouter>,
  );
}
describe('dashboard application', () => {
  it('renders the overview and opens the exact approval dialog by keyboard', async () => {
    const user = userEvent.setup();
    view();
    expect(screen.getByRole('heading', { name: 'Vue d’ensemble' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Redémarrer le service PostgreSQL/u }));
    expect(screen.getByRole('dialog', { name: 'Approbation forte requise' })).toBeTruthy();
    expect(screen.getByText('sha256: 7c81…a94e')).toBeTruthy();
    expect(screen.getByLabelText('PIN local')).toBe(document.activeElement);
  });
  it('has no serious automatic accessibility violation on the overview', async () => {
    view();
    const result = await axe.run(document, { rules: { 'color-contrast': { enabled: false } } });
    expect(
      result.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
    ).toEqual([]);
  });
  it('does not place canary secrets in DOM or persistent browser storage', () => {
    localStorage.setItem('unrelated', 'safe');
    view();
    expect(document.body.textContent).not.toContain('CANARY_WEB_SECRET');
    expect(JSON.stringify(localStorage)).not.toContain('CANARY_WEB_SECRET');
  });
});
