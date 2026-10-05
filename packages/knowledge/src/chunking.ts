import { createHash } from 'node:crypto';
import type { KnowledgeChunk } from './types.js';

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function anchor(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 200);
  return normalized || 'document';
}

interface Section {
  readonly title: string;
  readonly start: number;
  readonly end: number;
}

function sections(content: string): readonly Section[] {
  const headings = [...content.matchAll(/^#{1,6}\s+(.+?)\s*$/gmu)].map((match) => ({
    title: match[1]?.trim() || 'Document',
    start: match.index ?? 0,
  }));
  if (headings.length === 0) return [{ title: 'Document', start: 0, end: content.length }];
  const result: Section[] = [];
  if (headings[0]!.start > 0) result.push({ title: 'Document', start: 0, end: headings[0]!.start });
  for (const [index, heading] of headings.entries()) {
    result.push({
      title: heading.title,
      start: heading.start,
      end: headings[index + 1]?.start ?? content.length,
    });
  }
  return result;
}

export function normalizeKnowledgeText(value: string): string {
  return value
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .normalize('NFC')
    .trim();
}

export function chunkKnowledgeText(
  raw: string,
  maximumCharacters = 4_000,
): readonly KnowledgeChunk[] {
  if (
    !Number.isSafeInteger(maximumCharacters) ||
    maximumCharacters < 256 ||
    maximumCharacters > 20_000
  ) {
    throw new Error('invalid_chunk_limit');
  }
  const content = normalizeKnowledgeText(raw);
  if (!content) return [];
  const chunks: KnowledgeChunk[] = [];
  for (const section of sections(content)) {
    let cursor = section.start;
    while (cursor < section.end) {
      let end = Math.min(cursor + maximumCharacters, section.end);
      if (end < section.end) {
        const boundary = content.lastIndexOf('\n', end);
        if (boundary > cursor + Math.floor(maximumCharacters / 2)) end = boundary;
      }
      const value = content.slice(cursor, end).trim();
      if (value) {
        chunks.push({
          ordinal: chunks.length,
          section: section.title,
          anchor: `${anchor(section.title)}${chunks.some((item) => item.anchor === anchor(section.title)) ? `-${chunks.length}` : ''}`,
          startOffset: cursor,
          endOffset: end,
          content: value,
          sha256: sha256(value),
          classification: 'LOCAL_ONLY',
          trust: 'DATA_ONLY',
        });
      }
      cursor = end;
      while (content[cursor] === '\n') cursor += 1;
    }
  }
  return chunks;
}
