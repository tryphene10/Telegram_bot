import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import process from 'node:process';

const skippedDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-types',
  'coverage',
  'artifacts',
  'test-results',
  'playwright-report',
]);
const textExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
  '.md',
  '.ps1',
  '.yml',
  '.yaml',
  '.sql',
  '.html',
  '.css',
]);
const findings = [];
const patterns = [
  { name: 'OpenAI key', value: /\bsk-[A-Za-z0-9_-]{32,}\b/gu },
  { name: 'Telegram token', value: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/gu },
  { name: 'Private key', value: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu },
  { name: 'Cloud credential', value: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu },
];
const canaries = [
  'sk-' + 'abcdefghijklmnopqrstuvwxyz0123456789ABCD',
  '123456789' + ':' + 'abcdefghijklmnopqrstuvwxyzABCDE_12345',
  '-----BEGIN ' + 'PRIVATE KEY-----',
  'AK' + 'IAABCDEFGHIJKLMNOP',
];

for (const [index, pattern] of patterns.entries()) {
  pattern.value.lastIndex = 0;
  if (!pattern.value.test(canaries[index]))
    throw new Error(`secret_scanner_canary_failed:${pattern.name}`);
}

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (
      textExtensions.has(extname(entry.name).toLowerCase()) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)
    ) {
      const content = await readFile(path, 'utf8');
      for (const pattern of patterns) {
        pattern.value.lastIndex = 0;
        if (pattern.value.test(content)) findings.push(`${pattern.name}: ${relative('.', path)}`);
      }
    }
  }
}

await scan('.');
if (findings.length) {
  for (const finding of findings) console.error(finding);
  process.exitCode = 1;
} else
  console.log('Secret scan: canaries detected; no credential pattern found in production files.');
import console from 'node:console';
