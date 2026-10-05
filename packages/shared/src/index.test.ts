import { describe, expect, it } from 'vitest';
import { healthy } from './index.js';

describe('shared health contract', () => {
  it('creates a healthy service value', () => {
    expect(healthy('test')).toEqual({ service: 'test', status: 'ok' });
  });
});
