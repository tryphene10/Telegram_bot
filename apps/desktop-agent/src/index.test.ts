import { describe, expect, it } from 'vitest';
import { desktopAgent } from './index.js';

describe('desktop agent guarded runtime', () => {
  it('advertises Computer Use without enabling UI input by default', () => {
    expect(desktopAgent).toMatchObject({
      service: 'desktop-agent',
      toolsEnabled: false,
      uiInputEnabledByDefault: false,
      status: 'guarded',
    });
  });
});
