import { describe, expect, it } from 'vitest';
import {
  buildUiaActionScript,
  buildUiaInspectionScript,
  parseUiaTree,
  resolveUniqueUiaElement,
} from './windows-uia.js';

const tree = parseUiaTree(
  JSON.stringify({
    truncated: false,
    elements: [
      {
        name: 'Save',
        automationId: 'save',
        className: 'Button',
        controlType: 'Button',
        enabled: true,
        offscreen: false,
        password: false,
        x: 1,
        y: 2,
        width: 40,
        height: 20,
      },
      {
        name: 'Secret',
        automationId: 'password',
        className: 'Edit',
        controlType: 'Edit',
        enabled: true,
        offscreen: false,
        password: true,
        x: 1,
        y: 30,
        width: 80,
        height: 20,
      },
    ],
  }),
  '42',
  '2026-10-01T12:00:00.000Z',
);

describe('WindowsUiaDriver', () => {
  it('builds a bounded inspection without reading values', () => {
    const script = buildUiaInspectionScript('42', 5, 100);
    expect(script).toContain('ControlViewWalker');
    expect(script).toContain('IsPassword');
    expect(script).not.toContain('ValuePattern.Current.Value');
  });

  it('resolves exactly one semantic control', () => {
    expect(resolveUniqueUiaElement(tree, { automationId: 'save' }).name).toBe('Save');
    expect(() => resolveUniqueUiaElement(tree, { controlType: 'Edit', name: 'missing' })).toThrow(
      'match_count_0',
    );
  });

  it('embeds selectors and values as base64 JSON and refuses empty selectors', () => {
    const script = buildUiaActionScript({
      windowHandle: '42',
      selector: { automationId: 'editor' },
      operation: 'SET_VALUE',
      value: "text with ' quotes",
    });
    expect(script).toContain('FromBase64String');
    expect(script).toContain('uia_password_field_refused');
    expect(script).not.toContain("text with ' quotes");
    expect(() =>
      buildUiaActionScript({ windowHandle: '42', selector: {}, operation: 'INVOKE' }),
    ).toThrow('semantic_selector_required');
  });
});
