import { describe, expect, it } from 'vitest';
import { chunkKnowledgeText, normalizeKnowledgeText, sha256 } from './chunking.js';

describe('knowledge chunking', () => {
  it('normalizes encoding and creates stable section chunks with hashes', () => {
    const input = '\uFEFF# Intro\r\nAlpha\r\n\r\n## Suite\r\nBeta';
    const first = chunkKnowledgeText(input, 256);
    const second = chunkKnowledgeText(normalizeKnowledgeText(input), 256);
    expect(first).toEqual(second);
    expect(first.map(({ section, anchor }) => ({ section, anchor }))).toEqual([
      { section: 'Intro', anchor: 'intro' },
      { section: 'Suite', anchor: 'suite' },
    ]);
    expect(first.every(({ sha256: digest, content }) => digest === sha256(content))).toBe(true);
    expect(first.every(({ trust }) => trust === 'DATA_ONLY')).toBe(true);
  });

  it('bounds chunks and rejects unsafe limits', () => {
    const chunks = chunkKnowledgeText(`# Long\n${'line\n'.repeat(200)}`, 256);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(({ content }) => content.length <= 256)).toBe(true);
    expect(() => chunkKnowledgeText('x', 10)).toThrow('invalid_chunk_limit');
  });
});
