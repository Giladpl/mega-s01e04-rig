import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunEvent } from './types.js';

function isCalendarDate(value: string): boolean {
  if (value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

type Instant = { seconds: number; fraction: string };

function timestamp(value: string): Instant | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!match || match[0] !== value || !isCalendarDate(match[1])) return null;
  const [, date, hours, minutes, seconds = '00', fraction = '', zone] = match;
  const hour = Number(hours);
  const minute = Number(minutes);
  const second = Number(seconds);
  if (hour > 24 || minute > 59 || second > 59) return null;
  if (hour === 24 && (minute !== 0 || second !== 0 || /[1-9]/.test(fraction))) return null;
  const offsetHours = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const offsetMinutes = zone === 'Z' ? 0 : Number(zone.slice(3).replace(':', '') || '0');
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const offset = (offsetHours * 60 + offsetMinutes) * (zone.startsWith('-') ? -1 : 1);
  const midnight = Date.parse(`${date}T00:00:00Z`) / 1000;
  return {
    seconds: midnight + hour * 3600 + minute * 60 + second - offset * 60,
    // Do not lose sub-millisecond ordering through Date.parse truncation.
    fraction: fraction.replace(/0+$/, ''),
  };
}

type TimedEvent = { event: RunEvent; instant: Instant; line: number };

function parseEvent(line: string, index: number): TimedEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.job !== 'string' || record.job.trim() === '') return null;
  if (typeof record.at !== 'string') return null;
  const instant = timestamp(record.at);
  if (!instant) return null;
  if (record.status !== 'ok' && record.status !== 'retry' && record.status !== 'fail') return null;
  if (record.owner !== null && typeof record.owner !== 'string') return null;
  if ('error' in record && typeof record.error !== 'string') return null;
  const event: RunEvent = {
    at: record.at,
    job: record.job,
    status: record.status,
    owner: record.owner,
  };
  if (typeof record.error === 'string') event.error = record.error;
  return { event, instant, line: index };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isCalendarDate(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const events: TimedEvent[] = [];
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue;
    const parsed = parseEvent(line, index);
    if (!parsed) {
      digest.badLines++;
      continue;
    }
    events.push(parsed);
    digest.counts[parsed.event.status]++;
  }
  events.sort((a, b) => a.instant.seconds - b.instant.seconds
    || compareText(a.instant.fraction, b.instant.fraction)
    || a.line - b.line);

  const rows = new Map<string, DigestRow>();
  for (const { event } of events) {
    let row = rows.get(event.job);
    if (!row) {
      row = {
        job: event.job, owner: event.owner, runs: 0, retries: 0,
        lastStatus: event.status, lastError: null, firstAt: event.at, lastAt: event.at,
      };
      rows.set(event.job, row);
    }
    row.runs++;
    if (event.status === 'retry') row.retries++;
    row.owner = event.owner;
    row.lastStatus = event.status;
    row.lastAt = event.at;
    if (event.error?.trim()) row.lastError = event.error;
  }
  digest.rows = [...rows.values()].sort((a, b) => compareText(a.job, b.job));
  return digest;
};
