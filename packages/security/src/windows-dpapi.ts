import { spawn } from 'node:child_process';
import type { KeyProtector } from './vault.js';

const commonScript =
  'Add-Type -AssemblyName System.Security;' +
  '$inputValue=[Console]::In.ReadToEnd().Trim();' +
  '$data=[Convert]::FromBase64String($inputValue);' +
  "$entropy=[Text.Encoding]::UTF8.GetBytes('ARCC-LOCAL-VAULT-V1');";

const protectScript =
  commonScript +
  '$output=[Security.Cryptography.ProtectedData]::Protect($data,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);' +
  '[Console]::Out.Write([Convert]::ToBase64String($output));';

const unprotectScript =
  commonScript +
  '$output=[Security.Cryptography.ProtectedData]::Unprotect($data,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);' +
  '[Console]::Out.Write([Convert]::ToBase64String($output));';

export class WindowsDpapiKeyProtector implements KeyProtector {
  async protect(key: Uint8Array): Promise<Uint8Array> {
    return this.run(protectScript, key);
  }

  async unprotect(protectedKey: Uint8Array): Promise<Uint8Array> {
    return this.run(unprotectScript, protectedKey);
  }

  private async run(script: string, input: Uint8Array): Promise<Uint8Array> {
    if (process.platform !== 'win32') {
      throw new Error('Windows DPAPI is only available on Windows');
    }

    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const output: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
      child.on('error', () => reject(new Error('Windows DPAPI process could not start')));
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error('Windows DPAPI operation failed'));
          return;
        }
        try {
          resolve(Buffer.from(Buffer.concat(output).toString('utf8').trim(), 'base64'));
        } catch {
          reject(new Error('Windows DPAPI returned invalid data'));
        }
      });
      child.stdin.end(Buffer.from(input).toString('base64'));
    });
  }
}
