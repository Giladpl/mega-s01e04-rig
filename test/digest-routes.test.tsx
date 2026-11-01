import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow, NightDigest, RunEvent } from '../src/digest/types.js';

const night = '2026-10-28';

function textContent(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (entity) => {
    const entities: Record<string, string> = {
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
      '&apos;': "'", '&#39;': "'", '&#x27;': "'",
    };
    return entities[entity];
  });
}

function tableRows(html: string): string[][] {
  const body = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/g)]
      .map((cell) => textContent(cell[1]).trim()),
  );
}

function rowCells(row: DigestRow): string[] {
  return [row.job, row.owner ?? '—', String(row.runs), String(row.retries),
    row.lastStatus, row.lastError ?? '—', row.firstAt, row.lastAt];
}

describe('digest routes', () => {
  let directory: string;
  let runsDir: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    runsDir = join(directory, 'runs');
    mkdirSync(runsDir);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function app() {
    return createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60, runsDir });
  }

  function writeEvents(events: RunEvent[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), events.map((event) => JSON.stringify(event)).join('\n'));
  }

  async function requestBoth() {
    const service = app();
    const html = await service.request(`/digest/${night}`);
    const json = await service.request(`/api/digest/${night}`);
    expect(html.status).toBe(200);
    expect(json.status).toBe(200);
    expect(html.headers.get('content-type')).toContain('text/html');
    expect(json.headers.get('content-type')).toContain('application/json');
    return { html: await html.text(), digest: await json.json() as NightDigest };
  }

  it('serves the full digest and the same complete table in code-unit job order', async () => {
    const at = '2026-10-28T01:00:00+03:00';
    // Input order deliberately differs from code-unit order and chronological order.
    writeEvents([
      { at, job: 'z-job', owner: 'Zed', status: 'fail', error: 'disk full' },
      { at: '2026-10-28T01:04:00+03:00', job: 'a-job', owner: null, status: 'ok' },
      { at, job: 'a-job', owner: 'Earlier owner', status: 'retry', error: 'temporary' },
      { at: '2026-10-28T01:02:00+03:00', job: 'a-job', owner: null, status: 'retry' },
      { at: '2026-10-28T01:03:00+03:00', job: 'a-job', owner: null, status: 'retry' },
      { at, job: 'B-job', owner: 'Bea', status: 'ok' },
    ]);
    const { html, digest } = await requestBoth();
    expect(digest).toEqual({
      rows: [
        { job: 'B-job', owner: 'Bea', runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: at, lastAt: at },
        { job: 'a-job', owner: null, runs: 4, retries: 3, lastStatus: 'ok', lastError: 'temporary', firstAt: at, lastAt: '2026-10-28T01:04:00+03:00' },
        { job: 'z-job', owner: 'Zed', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'disk full', firstAt: at, lastAt: at },
      ], badLines: 0, counts: { ok: 2, retry: 3, fail: 1 },
    });
    expect(tableRows(html)).toEqual(digest.rows.map(rowCells));
    const headers = [...html.matchAll(/<th\b[^>]*scope="col"[^>]*>([\s\S]*?)<\/th>/g)]
      .map((cell) => textContent(cell[1]));
    expect(headers).toEqual(['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first at', 'last at']);
    // A recovered job still needs its retry warning; a final failure is flagged too.
    expect(html).toMatch(/<strong\b[^>]*>3<\/strong>/);
    expect(html).toMatch(/<strong\b[^>]*>fail<\/strong>/);
    expect(html).toContain(at);
    expect(html).not.toContain('2026-10-27T22:00:00.000Z');
  });

  it('does not flag retries below the threshold', async () => {
    writeEvents([0, 1].map<RunEvent>((minute) => ({ at: `2026-10-28T01:0${minute}:00Z`, job: 'small', owner: null, status: 'retry' })));
    const { html, digest } = await requestBoth();
    expect(digest.rows[0].retries).toBe(2);
    expect(tableRows(html)).toEqual(digest.rows.map(rowCells));
    expect(html).not.toMatch(/<strong\b[^>]*>2<\/strong>/);
  });

  it('returns 404 for a missing night on both routes', async () => {
    for (const prefix of ['/digest', '/api/digest']) {
      expect((await app().request(`${prefix}/${night}`)).status).toBe(404);
    }
  });

  it('renders an existing empty night as nothing ran with an empty JSON digest', async () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    const { html, digest } = await requestBoth();
    expect(digest).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    expect(html).toContain('nothing ran');
    expect(tableRows(html)).toEqual([]);
  });

  it('skips malformed records, warns, and retains valid records on both sides', async () => {
    const event: RunEvent = { at: '2026-10-28T09:00:00-04:00', job: 'survivor', owner: null, status: 'ok' };
    writeFileSync(join(runsDir, `${night}.jsonl`), `${JSON.stringify(event)}\n{broken\n\n`);
    const { html, digest } = await requestBoth();
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0]).toMatchObject({ job: 'survivor', owner: null, firstAt: event.at, lastAt: event.at });
    expect(tableRows(html)).toEqual(digest.rows.map(rowCells));
    expect(html).toMatch(/1 bad line[\s\S]*skipped/);
  });

  it('warns even when every nonblank line is bad and nothing ran', async () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), '{broken\n{"job":"incomplete"}\n');
    const { html, digest } = await requestBoth();
    expect(digest).toEqual({ rows: [], badLines: 2, counts: { ok: 0, retry: 0, fail: 0 } });
    expect(html).toContain('nothing ran');
    expect(html).toMatch(/2 bad lines[\s\S]*skipped/);
  });

  it('escapes untrusted job, owner and error text while preserving their JSON values', async () => {
    const event: RunEvent = {
      at: '2026-10-28T01:00:00+03:00', status: 'fail',
      job: '<script>alert("job")</script>',
      owner: '<img src=x onerror="alert(1)"> & owner',
      error: '</td><script>alert("error")</script>',
    };
    writeEvents([event]);
    const { html, digest } = await requestBoth();
    expect(digest.rows[0]).toMatchObject({ job: event.job, owner: event.owner, lastError: event.error });
    expect(tableRows(html)).toEqual(digest.rows.map(rowCells));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('rejects invalid dates and traversal inputs even when target files exist', async () => {
    const sentinel = JSON.stringify({ at: '2026-10-28T01:00:00Z', job: 'OUTSIDE_SENTINEL', owner: null, status: 'ok' });
    writeFileSync(join(directory, `${night}.jsonl`), sentinel);
    for (const invalid of ['2026-02-30', '2026-13-01', '2026-2-03']) {
      writeFileSync(join(runsDir, `${invalid}.jsonl`), sentinel);
    }
    for (const prefix of ['/digest', '/api/digest']) {
      for (const input of ['2026-02-30', '2026-13-01', '2026-2-03', `..%2F${night}`, `%2E%2E%2F${night}`, `..%5C${night}`]) {
        const response = await app().request(`${prefix}/${input}`);
        expect(response.status, `${prefix}/${input}`).toBe(404);
        expect(await response.text()).not.toContain('OUTSIDE_SENTINEL');
      }
    }
  });
});
