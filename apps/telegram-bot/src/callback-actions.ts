import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ReplayStore } from './access-control.js';

export const CALLBACK_ACTIONS = [
  'DETAILS',
  'DIFF',
  'ARTIFACT',
  'COMMIT',
  'PUSH',
  'DEPLOY',
  'MODEL',
  'PLAN',
  'TAKEOVER',
  'CONTINUE',
  'RETRY',
  'PROOF',
  'QUEUE',
  'DRYRUN',
  'PURGE_MEMORY',
  'INVESTIGATE',
  'RESTART',
  'IGNORE',
] as const;
export type CallbackAction = (typeof CALLBACK_ACTIONS)[number];
const codes: Readonly<Record<CallbackAction, string>> = {
  DETAILS: 'd',
  DIFF: 'f',
  ARTIFACT: 'a',
  COMMIT: 'c',
  PUSH: 'p',
  DEPLOY: 'x',
  MODEL: 'm',
  PLAN: 'l',
  TAKEOVER: 't',
  CONTINUE: 'n',
  RETRY: 'r',
  PROOF: 'o',
  QUEUE: 'q',
  DRYRUN: 'y',
  PURGE_MEMORY: 'g',
  INVESTIGATE: 'i',
  RESTART: 'j',
  IGNORE: 'k',
};
const actions = Object.fromEntries(
  Object.entries(codes).map(([key, value]) => [value, key]),
) as Readonly<Record<string, CallbackAction>>;

export class CallbackActionCodec {
  constructor(
    private readonly key: Buffer,
    private readonly replay: ReplayStore,
    private readonly now: () => number = Date.now,
  ) {
    if (key.length < 32) throw new Error('callback_key_too_short');
  }

  issue(
    action: CallbackAction,
    target: string,
    lifetimeMs = 10 * 60_000,
    stateTag = 'state0',
  ): string {
    if (!/^[A-Za-z0-9_-]{1,16}$/u.test(target)) throw new Error('invalid_callback_target');
    if (!/^[A-Za-z0-9_-]{1,8}$/u.test(stateTag)) throw new Error('invalid_callback_state');
    const expiry = Math.floor((this.now() + lifetimeMs) / 1000).toString(36);
    const nonce = randomBytes(5).toString('base64url');
    const body = `2.${expiry}.${nonce}.${codes[action]}.${target}.${stateTag}`;
    const signature = createHmac('sha256', this.key).update(body).digest('base64url').slice(0, 16);
    const token = `${body}.${signature}`;
    if (Buffer.byteLength(token, 'utf8') > 64) throw new Error('callback_token_too_long');
    return token;
  }

  async consume(token: string): Promise<{
    readonly action: CallbackAction;
    readonly target: string;
    readonly stateTag: string;
  }> {
    const parts = token.split('.');
    if (parts.length !== 7 || parts[0] !== '2') throw new Error('invalid_callback');
    const [version, expiryValue, nonce, code, target, stateTag, supplied] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const body = `${version}.${expiryValue}.${nonce}.${code}.${target}.${stateTag}`;
    const expected = createHmac('sha256', this.key).update(body).digest('base64url').slice(0, 16);
    const left = Buffer.from(supplied);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right))
      throw new Error('invalid_callback');
    const expiry = Number.parseInt(expiryValue, 36) * 1000;
    const action = actions[code];
    if (!action || expiry <= this.now()) throw new Error('expired_callback');
    if (!(await this.replay.claim(`callback-action:${nonce}`, expiry)))
      throw new Error('replayed_callback');
    return { action, target, stateTag };
  }
}
