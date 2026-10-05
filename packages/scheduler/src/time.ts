import type { DueOccurrence, ScheduleDefinition } from './types.js';

const MINIMUM_INTERVAL_MS = 15 * 60_000;
const SEARCH_LIMIT_MINUTES = 2 * 366 * 24 * 60;

export class ScheduleValidationError extends Error {
  constructor(readonly reason: string) {
    super(`Schedule rejected: ${reason}`);
    this.name = 'ScheduleValidationError';
  }
}

interface LocalParts {
  readonly minute: number;
  readonly hour: number;
  readonly day: number;
  readonly month: number;
  readonly weekday: number;
}

function localParts(date: Date, timezone: string): LocalParts {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
  } catch {
    throw new ScheduleValidationError('invalid_iana_timezone');
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const weekdays: Readonly<Record<string, number>> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: weekdays[parts.weekday ?? ''] ?? -1,
  };
}

function values(field: string, minimum: number, maximum: number): ReadonlySet<number> {
  const result = new Set<number>();
  for (const token of field.split(',')) {
    const stepParts = token.split('/');
    if (stepParts.length > 2) throw new ScheduleValidationError('invalid_cron_field');
    const base = stepParts[0] ?? '';
    const step = stepParts[1] === undefined ? 1 : Number(stepParts[1]);
    if (!Number.isInteger(step) || step < 1) throw new ScheduleValidationError('invalid_cron_step');
    let first: number;
    let last: number;
    if (base === '*') {
      first = minimum;
      last = maximum;
    } else if (base.includes('-')) {
      const [left, right] = base.split('-').map(Number);
      if (left === undefined || right === undefined)
        throw new ScheduleValidationError('invalid_cron_range');
      first = left;
      last = right;
    } else {
      first = Number(base);
      last = first;
    }
    if (
      !Number.isInteger(first) ||
      !Number.isInteger(last) ||
      first < minimum ||
      last > maximum ||
      first > last
    )
      throw new ScheduleValidationError('cron_value_out_of_range');
    for (let value = first; value <= last; value += step) result.add(value);
  }
  return result;
}

function parseCron(expression: string) {
  const fields = expression.trim().split(/\s+/u);
  if (fields.length !== 5) throw new ScheduleValidationError('cron_requires_five_fields');
  const [minute = '', hour = '', day = '', month = '', weekday = ''] = fields;
  if (day !== '*' && weekday !== '*') throw new ScheduleValidationError('ambiguous_day_fields');
  return {
    minute: values(minute, 0, 59),
    hour: values(hour, 0, 23),
    day: values(day, 1, 31),
    month: values(month, 1, 12),
    weekday: values(weekday, 0, 6),
  };
}

function intervalMs(expression: string): number {
  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(expression);
  const milliseconds = iso
    ? (Number(iso[1] ?? 0) * 3600 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0)) * 1000
    : Number(expression) * 1000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < MINIMUM_INTERVAL_MS)
    throw new ScheduleValidationError('interval_below_fifteen_minutes');
  return milliseconds;
}

function minuteOfDay(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value);
  if (!match) throw new ScheduleValidationError('invalid_time_window');
  return Number(match[1]) * 60 + Number(match[2]);
}

function inWindow(date: Date, schedule: ScheduleDefinition): boolean {
  if (!schedule.window) return true;
  const current = localParts(date, schedule.timezone);
  const minute = current.hour * 60 + current.minute;
  const start = minuteOfDay(schedule.window.start);
  const end = minuteOfDay(schedule.window.end);
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

function cronNext(expression: string, timezone: string, after: Date): Date {
  const cron = parseCron(expression);
  let candidate = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  for (let index = 0; index < SEARCH_LIMIT_MINUTES; index += 1) {
    const part = localParts(candidate, timezone);
    if (
      cron.minute.has(part.minute) &&
      cron.hour.has(part.hour) &&
      cron.day.has(part.day) &&
      cron.month.has(part.month) &&
      cron.weekday.has(part.weekday)
    )
      return candidate;
    candidate = new Date(candidate.getTime() + 60_000);
  }
  throw new ScheduleValidationError('cron_has_no_occurrence_in_search_horizon');
}

export function validateSchedule(schedule: ScheduleDefinition): void {
  localParts(new Date(0), schedule.timezone);
  if (
    !Number.isInteger(schedule.catchUpLimit) ||
    schedule.catchUpLimit < 1 ||
    schedule.catchUpLimit > 100
  )
    throw new ScheduleValidationError('invalid_catch_up_limit');
  if (schedule.window) {
    minuteOfDay(schedule.window.start);
    minuteOfDay(schedule.window.end);
  }
  if (schedule.triggerType === 'INTERVAL') intervalMs(schedule.expression);
  if (schedule.triggerType === 'ONE_SHOT' && !Number.isFinite(Date.parse(schedule.expression)))
    throw new ScheduleValidationError('invalid_one_shot_timestamp');
  if (schedule.triggerType === 'CRON') {
    const first = cronNext(schedule.expression, schedule.timezone, new Date(0));
    const second = cronNext(schedule.expression, schedule.timezone, first);
    if (second.getTime() - first.getTime() < MINIMUM_INTERVAL_MS)
      throw new ScheduleValidationError('cron_below_fifteen_minutes');
  }
  if (
    schedule.triggerType === 'LOCAL_EVENT' &&
    !/^[A-Za-z0-9_.:-]{1,128}$/u.test(schedule.expression)
  )
    throw new ScheduleValidationError('invalid_local_event_key');
}

export function nextOccurrence(schedule: ScheduleDefinition, after: Date): Date | undefined {
  validateSchedule(schedule);
  let value: Date | undefined;
  if (schedule.triggerType === 'ONE_SHOT') {
    const oneShot = new Date(schedule.expression);
    value = oneShot.getTime() > after.getTime() ? oneShot : undefined;
  } else if (schedule.triggerType === 'INTERVAL') {
    const interval = intervalMs(schedule.expression);
    const anchor = schedule.nextRunAt ? Date.parse(schedule.nextRunAt) : after.getTime();
    value = new Date(
      anchor > after.getTime()
        ? anchor
        : anchor + (Math.floor((after.getTime() - anchor) / interval) + 1) * interval,
    );
  } else if (schedule.triggerType === 'CRON')
    value = cronNext(schedule.expression, schedule.timezone, after);
  if (!value || schedule.triggerType === 'LOCAL_EVENT') return undefined;
  while (!inWindow(value, schedule)) {
    value =
      schedule.triggerType === 'CRON'
        ? cronNext(schedule.expression, schedule.timezone, value)
        : new Date(value.getTime() + intervalMs(schedule.expression));
  }
  return value;
}

function occurrence(due: Date): DueOccurrence {
  const dueAt = due.toISOString();
  return { dueAt, key: dueAt };
}

export function dueOccurrences(schedule: ScheduleDefinition, now: Date): readonly DueOccurrence[] {
  validateSchedule(schedule);
  if (schedule.triggerType === 'LOCAL_EVENT' || !schedule.nextRunAt) return [];
  const first = new Date(schedule.nextRunAt);
  if (!Number.isFinite(first.getTime()) || first.getTime() > now.getTime()) return [];
  const due: Date[] = [];
  let cursor: Date | undefined = first;
  const hardLimit = Math.max(schedule.catchUpLimit, 1) + 1000;
  while (cursor && cursor.getTime() <= now.getTime() && due.length < hardLimit) {
    if (inWindow(cursor, schedule)) due.push(cursor);
    if (schedule.triggerType === 'ONE_SHOT') break;
    cursor = nextOccurrence({ ...schedule, nextRunAt: cursor.toISOString() }, cursor);
  }
  if (schedule.catchUpPolicy === 'SKIP') return [];
  if (schedule.catchUpPolicy === 'LATEST_ONLY')
    return due.length ? [occurrence(due.at(-1) as Date)] : [];
  return due.slice(-schedule.catchUpLimit).map(occurrence);
}

export function localEventOccurrence(
  schedule: ScheduleDefinition,
  eventKey: string,
  eventId: string,
  occurredAt: Date,
): DueOccurrence | undefined {
  validateSchedule(schedule);
  if (
    schedule.triggerType !== 'LOCAL_EVENT' ||
    schedule.expression !== eventKey ||
    !inWindow(occurredAt, schedule)
  )
    return undefined;
  return { key: `event:${eventKey}:${eventId}`, dueAt: occurredAt.toISOString() };
}
