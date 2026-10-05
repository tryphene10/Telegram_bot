import console from 'node:console';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';

const forbidden = [
  { roots: ['apps/telegram-bot', 'apps/web-dashboard'], packages: ['@arcc/tools'] },
  { roots: ['apps/api'], packages: ['node:child_process'] },
  {
    roots: ['apps', 'packages/agents', 'packages/tools'],
    packages: ['openai', '@anthropic-ai/sdk'],
  },
];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (
      entry.isDirectory() &&
      !['dist', 'dist-types', 'node_modules', 'playwright-report', 'test-results'].includes(
        entry.name,
      )
    ) {
      files.push(...(await collect(path)));
    } else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

let failed = false;
for (const rule of forbidden) {
  for (const root of rule.roots) {
    const files = await collect(root);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      for (const packageName of rule.packages) {
        if (
          content.includes(`from '${packageName}'`) ||
          content.includes(`from "${packageName}"`)
        ) {
          console.error(`Forbidden dependency ${packageName} in ${relative('.', file)}`);
          failed = true;
        }
      }
    }
  }
}

const networkFiles = [...(await collect('apps')), ...(await collect('packages'))];
for (const file of networkFiles) {
  const normalized = file.replaceAll('\\', '/');
  if (normalized.endsWith('packages/security/src/egress-gateway.ts')) continue;
  if (normalized.endsWith('packages/security/src/secure-http-transport.ts')) continue;
  if (normalized.endsWith('apps/telegram-bot/src/telegram-api.ts')) continue;
  // The browser client is constrained to relative, same-origin /api paths by construction.
  if (normalized.endsWith('apps/web-dashboard/src/api-client.ts')) continue;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(normalized)) continue;
  const content = await readFile(file, 'utf8');
  const directNetwork =
    /\bfetch\s*\(/u.test(content) ||
    /from\s+['"](?:undici|axios|openai|@anthropic-ai\/sdk)['"]/u.test(content);
  if (directNetwork) {
    console.error(`Network egress must pass through the gateway: ${relative('.', file)}`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
else console.log('Architecture boundaries: OK');
