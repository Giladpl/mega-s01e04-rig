import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const night = '2026-10-28';
const empty = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
const event = { at: '2026-10-28T12:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };
let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rig-reader-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function write(records: unknown[]) {
  writeFileSync(join(dir, `${night}.jsonl`), records.map(record => JSON.stringify(record)).join('\n'));
}

describe('readNight', () => {
  it('reads the real fixture without dropping null owners or losing recovered errors', () => {
    const digest = readNight('runs', night);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0]).toMatchObject({ owner: null, runs: 1 });
    expect(digest?.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
      lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest?.rows[2]).toMatchObject({ runs: 8, retries: 1, lastError: 'lock held' });
    expect(digest?.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('returns null for missing files and invalid calendar dates or traversal', () => {
    expect(readNight(dir, night)).toBeNull();
    // A file exists even for invalid names: validation must precede filesystem access.
    for (const invalid of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-1-01', `${night}\n`]) {
      writeFileSync(join(dir, `${invalid}.jsonl`), '');
      expect(readNight(dir, invalid)).toBeNull();
    }
    write([]);
    for (const invalid of [`../${night}`, `./${night}`, `${night}.jsonl`, `${night}/x`, `${night}\n`, '']) {
      expect(readNight(dir, invalid)).toBeNull();
    }
    for (const leap of ['2000-02-29', '2024-02-29']) {
      writeFileSync(join(dir, `${leap}.jsonl`), '');
      expect(readNight(dir, leap)).toEqual(empty);
    }
  });

  it('distinguishes empty or blank files from missing files', () => {
    write([]);
    expect(readNight(dir, night)).toEqual(empty);
    writeFileSync(join(dir, `${night}.jsonl`), '\r\n \n\t\r\n');
    expect(readNight(dir, night)).toEqual(empty);
  });

  it('propagates I/O errors other than a missing file', () => {
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
    const notDirectory = join(dir, 'file');
    writeFileSync(notDirectory, '');
    expect(() => readNight(notDirectory, night)).toThrow();
  });

  it('counts malformed JSON and schema failures, then continues with valid events', () => {
    const invalid = [
      null, [], 3, 'string', {}, { ...event, job: '' }, { ...event, job: '  ' },
      { ...event, owner: undefined }, { ...event, owner: 5 }, { ...event, status: 'unknown' },
      { ...event, error: null }, { ...event, error: 3 }, { ...event, at: 42 },
      ...['not a date', '2026-02-30T12:00:00Z', '2026-10-28', '2026-10-28T12:00:00',
        '2026-10-28T25:00:00Z', '2026-10-28T24:01:00Z', '2026-10-28T24:00:00.1Z',
        '2026-10-28T12:60:00Z', '2026-10-28T12:00:60Z', '2026-10-28T12:00:00+24:00',
        '2026-10-28T12:00:00+01:60', '2026-10-28T12:00:00Z\n'].map(at => ({ ...event, at })),
    ];
    const valid = JSON.stringify({ ...event, owner: null, extra: true });
    writeFileSync(join(dir, `${night}.jsonl`), [valid, ...invalid.map(record => JSON.stringify(record)), '{broken', ' ', valid].join('\n'));
    expect(readNight(dir, night)).toMatchObject({
      badLines: invalid.length + 1, counts: { ok: 2, retry: 0, fail: 0 },
      rows: [{ job: 'job', runs: 2, owner: null, lastError: null }],
    });
  });

  it('sorts by instant and line ties, retaining the latest nonblank error across recovery', () => {
    write([
      { ...event, at: '2026-10-28T14:00:00+02:00', status: 'fail', error: ' latest error ' },
      { ...event, at: '2026-10-28T10:00:00Z', status: 'retry', error: 'old error' },
      { ...event, at: '2026-10-28T08:00:00-02:00', status: 'retry', error: 'old tie error' },
      { ...event, at: '2026-10-28T12:00:00Z', owner: null, error: ' \t ' },
    ]);
    expect(readNight(dir, night)).toEqual({
      badLines: 0, counts: { ok: 1, retry: 2, fail: 1 }, rows: [{
        job: 'job', owner: null, runs: 4, retries: 2, lastStatus: 'ok', lastError: ' latest error ',
        firstAt: '2026-10-28T10:00:00Z', lastAt: '2026-10-28T12:00:00Z',
      }],
    });
  });

  it('breaks error timestamp ties by line and keeps timestamps below millisecond precision', () => {
    write([
      { ...event, at: '2026-10-28T12:00:00.0002Z', error: 'newest' },
      { ...event, at: '2026-10-28T12:00:00.0001Z', error: 'earlier' },
      { ...event, at: '2026-10-28T13:00:00.000200+01:00', error: 'tie wins' },
    ]);
    expect(readNight(dir, night)?.rows[0]).toMatchObject({
      firstAt: '2026-10-28T12:00:00.0001Z', lastAt: '2026-10-28T13:00:00.000200+01:00', lastError: 'tie wins',
    });
  });

  it('uses code-unit job order and supports job names that look like object properties', () => {
    const jobs = ['é', 'a', 'Z', '__proto__', 'constructor', 'A'];
    write(jobs.map(job => ({ ...event, job, error: '' })));
    const rows = readNight(dir, night)?.rows;
    expect(rows?.map(row => row.job)).toEqual(['A', 'Z', '__proto__', 'a', 'constructor', 'é']);
    expect(rows?.every(row => row.lastError === null && row.runs === 1)).toBe(true);
  });
});
