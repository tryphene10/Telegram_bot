import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  CursorPageDto,
  DiagnosticDto,
  EntityDto,
  EntityKind,
  MutationRequestDto,
  MutationResultDto,
  OverviewDto,
  RealtimeEventDto,
} from '@arcc/web-contracts';
import { boundedQuery, parseMutationRequest } from '@arcc/web-contracts';

export interface DashboardApplicationPort {
  overview(correlationId: string): Promise<OverviewDto>;
  list(
    kind: EntityKind,
    query: { readonly limit: number; readonly sort: string; readonly cursor?: string },
    correlationId: string,
  ): Promise<CursorPageDto<EntityDto>>;
  diagnostic(correlationId: string): Promise<DiagnosticDto>;
  mutate(
    input: MutationRequestDto,
    context: { readonly sessionId: string; readonly correlationId: string },
  ): Promise<MutationResultDto>;
  events(after: number, limit: number): Promise<readonly RealtimeEventDto[]>;
}
export interface LocalPinPort {
  verify(pin: string): Promise<boolean>;
}
export interface HttpAuditPort {
  record(event: Readonly<Record<string, unknown>>): Promise<void>;
}
interface Session {
  readonly id: string;
  readonly csrf: string;
  expiresAt: number;
}
export interface DashboardServerOptions {
  readonly application: DashboardApplicationPort;
  readonly pin: LocalPinPort;
  readonly audit: HttpAuditPort;
  readonly now?: () => number;
  readonly sessionLifetimeMs?: number;
  readonly tls?: boolean;
  readonly allowedOrigins?: readonly string[];
}

const JSON_TYPE = 'application/json; charset=utf-8';
const kinds = new Set<EntityKind>([
  'users',
  'machines',
  'projects',
  'missions',
  'approvals',
  'agents',
  'models',
  'schedules',
  'incidents',
  'artifacts',
  'audit',
  'usage',
]);
function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function cookie(request: IncomingMessage, name: string) {
  const pair = (request.headers.cookie ?? '')
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
  return pair?.slice(name.length + 1);
}
function localHost(value: string | undefined) {
  if (!value) return false;
  const host = value.toLowerCase().split(':')[0];
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}
function localAddress(value: string | undefined) {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}
function securityHeaders(response: ServerResponse, correlationId: string) {
  response.setHeader('x-correlation-id', correlationId);
  response.setHeader(
    'content-security-policy',
    "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  response.setHeader('cache-control', 'no-store');
}
function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': JSON_TYPE });
  response.end(JSON.stringify(value));
}
async function readBody(request: IncomingMessage, maximum = 65_536) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > maximum) throw new Error('body_too_large');
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
}

export function createDashboardHandler(options: DashboardServerOptions) {
  const sessions = new Map<string, Session>();
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const now = options.now ?? Date.now;
  const lifetime = options.sessionLifetimeMs ?? 15 * 60_000;
  const origins = new Set(
    options.allowedOrigins ?? [
      'http://127.0.0.1:4173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://localhost:5173',
    ],
  );
  return async (request: IncomingMessage, response: ServerResponse) => {
    const started = now();
    const correlationId = randomUUID();
    securityHeaders(response, correlationId);
    let status = 500;
    let outcome = 'failed';
    try {
      if (!localAddress(request.socket.remoteAddress) || !localHost(request.headers.host)) {
        status = 403;
        outcome = 'non_local_request';
        send(response, status, {
          version: 'v1',
          error: {
            code: outcome,
            message: 'Requete locale requise.',
            correlationId,
            retryable: false,
          },
        });
        return;
      }
      const origin = request.headers.origin;
      if (origin && !origins.has(origin)) {
        status = 403;
        outcome = 'origin_denied';
        send(response, status, {
          version: 'v1',
          error: {
            code: outcome,
            message: 'Origine refusee.',
            correlationId,
            retryable: false,
          },
        });
        return;
      }
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
      if (request.method === 'GET' && url.pathname === '/health') {
        status = 200;
        outcome = 'ok';
        send(response, status, { service: 'command-center-api', status: 'ok' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/ready') {
        status = 200;
        outcome = 'ready';
        send(response, status, { version: 'v1', status: 'ready', correlationId });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/session') {
        const key = request.socket.remoteAddress ?? 'local';
        const rate = attempts.get(key) ?? { count: 0, resetAt: now() + 60_000 };
        if (rate.resetAt <= now()) {
          rate.count = 0;
          rate.resetAt = now() + 60_000;
        }
        if (rate.count >= 5) {
          status = 429;
          outcome = 'pin_rate_limited';
          send(response, status, {
            version: 'v1',
            error: {
              code: outcome,
              message: 'Trop de tentatives.',
              correlationId,
              retryable: true,
            },
          });
          return;
        }
        const value = await readBody(request);
        const pin =
          typeof value === 'object' && value !== null && 'pin' in value ? String(value.pin) : '';
        if (!(await options.pin.verify(pin))) {
          rate.count += 1;
          attempts.set(key, rate);
          status = 401;
          outcome = 'pin_rejected';
          send(response, status, {
            version: 'v1',
            error: {
              code: outcome,
              message: 'PIN refuse.',
              correlationId,
              retryable: true,
            },
          });
          return;
        }
        const id = randomBytes(24).toString('base64url');
        const csrf = randomBytes(24).toString('base64url');
        sessions.set(id, { id, csrf, expiresAt: now() + lifetime });
        const secure = options.tls === true ? '; Secure' : '';
        response.setHeader(
          'set-cookie',
          `arcc_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(lifetime / 1000)}${secure}`,
        );
        status = 201;
        outcome = 'session_created';
        send(response, status, {
          version: 'v1',
          csrfToken: csrf,
          expiresAt: new Date(now() + lifetime).toISOString(),
          correlationId,
        });
        return;
      }
      if (!url.pathname.startsWith('/api/v1/')) {
        status = 404;
        outcome = 'not_found';
        send(response, status, {
          version: 'v1',
          error: {
            code: outcome,
            message: 'Route inconnue.',
            correlationId,
            retryable: false,
          },
        });
        return;
      }
      const sessionId = cookie(request, 'arcc_session');
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session || session.expiresAt <= now()) {
        status = 401;
        outcome = 'session_required';
        send(response, status, {
          version: 'v1',
          error: {
            code: outcome,
            message: 'Session locale requise.',
            correlationId,
            retryable: false,
          },
        });
        return;
      }
      session.expiresAt = now() + lifetime;
      if (request.method === 'POST' && url.pathname === '/api/v1/session/rotate') {
        const csrf = request.headers['x-csrf-token'];
        if (typeof csrf !== 'string' || !equal(csrf, session.csrf)) {
          status = 403;
          outcome = 'csrf_denied';
          send(response, status, {
            version: 'v1',
            error: {
              code: outcome,
              message: 'Protection CSRF requise.',
              correlationId,
              retryable: false,
            },
          });
          return;
        }
        const rotatedId = randomBytes(24).toString('base64url');
        const rotatedCsrf = randomBytes(24).toString('base64url');
        sessions.delete(session.id);
        sessions.set(rotatedId, { id: rotatedId, csrf: rotatedCsrf, expiresAt: now() + lifetime });
        const secure = options.tls === true ? '; Secure' : '';
        response.setHeader(
          'set-cookie',
          `arcc_session=${rotatedId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(lifetime / 1000)}${secure}`,
        );
        status = 200;
        outcome = 'session_rotated';
        send(response, status, {
          version: 'v1',
          csrfToken: rotatedCsrf,
          expiresAt: new Date(now() + lifetime).toISOString(),
          correlationId,
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/overview') {
        status = 200;
        outcome = 'overview';
        send(response, status, await options.application.overview(correlationId));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/diagnostic') {
        status = 200;
        outcome = 'diagnostic';
        send(response, status, await options.application.diagnostic(correlationId));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/events') {
        const after = Math.max(0, Number.parseInt(url.searchParams.get('cursor') ?? '0', 10) || 0);
        const events = await options.application.events(after, 100);
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'x-accel-buffering': 'no',
        });
        for (const event of events)
          response.write(
            `id: ${event.sequence}\nevent: projection\ndata: ${JSON.stringify(event)}\n\n`,
          );
        response.end();
        status = 200;
        outcome = 'events';
        return;
      }
      const entity = /^\/api\/v1\/entities\/([a-z]+)$/u.exec(url.pathname);
      if (request.method === 'GET' && entity) {
        const kind = entity[1] as EntityKind;
        if (!kinds.has(kind)) throw new Error('entity_not_allowed');
        status = 200;
        outcome = `list_${kind}`;
        send(
          response,
          status,
          await options.application.list(kind, boundedQuery(url.searchParams), correlationId),
        );
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/actions') {
        const csrf = request.headers['x-csrf-token'];
        if (typeof csrf !== 'string' || !equal(csrf, session.csrf)) {
          status = 403;
          outcome = 'csrf_denied';
          send(response, status, {
            version: 'v1',
            error: {
              code: outcome,
              message: 'Protection CSRF requise.',
              correlationId,
              retryable: false,
            },
          });
          return;
        }
        const input = parseMutationRequest(await readBody(request));
        const result = await options.application.mutate(input, {
          sessionId: session.id,
          correlationId,
        });
        status = 200;
        outcome = result.status;
        send(response, status, result);
        return;
      }
      status = 404;
      outcome = 'not_found';
      send(response, status, {
        version: 'v1',
        error: {
          code: outcome,
          message: 'Route inconnue.',
          correlationId,
          retryable: false,
        },
      });
    } catch (error) {
      status =
        error instanceof SyntaxError
          ? 400
          : error instanceof Error && error.message === 'body_too_large'
            ? 413
            : 400;
      outcome = error instanceof Error ? error.message : 'invalid_request';
      send(response, status, {
        version: 'v1',
        error: {
          code: outcome,
          message: 'Requete invalide.',
          correlationId,
          retryable: false,
        },
      });
    } finally {
      await options.audit.record({
        event: 'HTTP_REQUEST',
        method: request.method,
        route: (request.url ?? '/').split('?')[0],
        status,
        durationMs: Math.max(0, now() - started),
        outcome,
        correlationId,
      });
    }
  };
}
