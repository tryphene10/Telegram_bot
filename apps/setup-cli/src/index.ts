import process from 'node:process';
import { configureLocalRuntime } from './configuration.js';

export * from './configuration.js';

if (process.argv[1]?.endsWith('index.js')) {
  const dataDirectory = process.argv[2];
  if (!dataDirectory) throw new Error('data_directory_required');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  const result = await configureLocalRuntime(dataDirectory, JSON.parse(raw));
  process.stdout.write(
    `${JSON.stringify({ event: 'setup.completed', autonomy: result.autonomy, apiHost: result.apiHost })}\n`,
  );
}
