export interface RedactionResult {
  readonly text: string;
  readonly replacements: number;
}

const builtInPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/giu,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu,
  /\b(?:api[_-]?key|password|passwd|secret|token|cookie)\s*[:=]\s*(['"]?)[^\s,'";]+\1/giu,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b/gu,
];

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

export class SecretRedactor {
  private readonly patterns: readonly RegExp[];

  constructor(secretCanaries: readonly string[] = [], extraPatterns: readonly RegExp[] = []) {
    const canaryPatterns = secretCanaries
      .filter((value) => value.length > 0)
      .map((value) => new RegExp(escapeRegExp(value), 'gu'));
    this.patterns = [...builtInPatterns, ...canaryPatterns, ...extraPatterns];
  }

  redact(value: string): RedactionResult {
    let text = value;
    let replacements = 0;
    for (const pattern of this.patterns) {
      pattern.lastIndex = 0;
      text = text.replace(pattern, () => {
        replacements += 1;
        return '[REDACTED]';
      });
    }
    return { text, replacements };
  }
}
