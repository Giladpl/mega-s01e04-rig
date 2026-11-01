---
plan: morning-digest
status: done
owner: rook
opened: 2026-10-29
completed: 2026-11-01
---

# Morning digest

The night's run log is a JSONL file nobody reads. By breakfast someone has to know what ran,
what retried, what failed, and whose it was, without opening `runs/`. rig already serves the
status board; the digest is one more page on it.

Out of scope: notifications, history across nights, auth (rig only listens on localhost).

## 1. Run log reader

Read `runs/<night>.jsonl` into one row per job: job, owner, runs, retries, last status, last
error, first and last time. One JSON object per line (`at`, `job`, `status`: `ok | retry | fail`,
`owner`, optional `error`).

- A line that doesn't parse is counted, never thrown. The night still renders.
- `owner` can be `null`. Keep the row; show the owner as `—`.
- Lives in `src/digest/`. Commit `src/digest/types.ts` first (the `DigestRow` type and the
  `readNight(runsDir, night)` signature), so every part of section 2 can start against it.

Done when: reader tests pass on `runs/2026-10-28.jsonl` (5 jobs, 1 bad line).

## 2. Digest page

Four small parts. Each needs only `src/digest/types.ts` from section 1, so once that is in they
can go to four workers at once. Small, well-specified work: a cheaper model is fine here.

### 2a. Page

`GET /digest/:night` renders the rows with the usual layout: one table, sorted by job, retries of
3 or more and any `fail` marked. A night with no file returns 404; an empty file renders
"nothing ran".

Done when: `/digest/2026-10-28` renders locally.

### 2b. JSON

`GET /api/digest/:night` returns the same rows as JSON. Agents read this one; the page and the
JSON must never disagree (ADR 0001).

Done when: the JSON for 2026-10-28 has the same jobs, in the same order, as the page.

### 2c. Board link

The status board links each night on disk to its digest, with its ok / retry / fail counts beside
it.

Done when: both nights on disk link to a digest that renders.

### 2d. Route tests

Route tests for 2a and 2b: 200, 404 for a night with no file, the empty night, a night with a bad
line. Use a temp runs dir; `runs/` is read-only.

Done when: `pnpm test` is green with the new tests.

## 3. Preview for review

The reviewer reads the page from a copy, not from the lane. Run rig and save `/digest/2026-10-28` as
one HTML file, lane banner included (a command, not a browser's "save as"; the page is
self-contained, ADR 0001). Put it on your own public host, one where you can upload over it later (any bucket
or static host, ADR 0003), so it opens from a public HTTPS link. Send the reviewer the link and the
issues for this plan.

Done when: the preview link is sent to the reviewer.

## 4. Clean up

The preview carries this lane's marker on a public link (ADR 0003). Take the marker off: save the
page again with `LANE_MARKER` unset (the banner reads "no marker set") and upload it over the same
link. Move this plan to `docs/plans/done/` with its issue list.

Done when: the preview link no longer shows the lane marker.

## Completed work

- [#1 — Define the shared digest contract](https://github.com/Giladpl/mega-s01e04-rig/issues/1)
- [#2 — Implement the run log reader](https://github.com/Giladpl/mega-s01e04-rig/issues/2)
- [#3 — Render the digest HTML page](https://github.com/Giladpl/mega-s01e04-rig/issues/3)
- [#4 — Expose digest rows as JSON](https://github.com/Giladpl/mega-s01e04-rig/issues/4)
- [#5 — Link available nights from the status board](https://github.com/Giladpl/mega-s01e04-rig/issues/5)
- [#6 — Test digest HTML and JSON routes](https://github.com/Giladpl/mega-s01e04-rig/issues/6)
- [#7 — Publish and submit the digest review copy](https://github.com/Giladpl/mega-s01e04-rig/issues/7)
- [#8 — Remove the public marker after review and archive the plan](https://github.com/Giladpl/mega-s01e04-rig/issues/8)

## Completion evidence

- `pnpm test`: 18 tests passed across 3 files; `pnpm typecheck`: passed.
- Both fixture nights were inspected in the browser through status-board links.
- Public review copy: https://mega-s01e04-rig-giladpl.vercel.app
- The course explicitly confirmed that the reviewer saw the preview before cleanup.
- The same public URL now returns the re-exported page with `LANE_MARKER` unset and the banner `no marker set`; anonymous HTTP 200 matches the prepared clean HTML byte for byte.
- No preview HTML or lane marker is committed in this repository.

## Review handoff correction

Issue #7 was initially closed after sending the link. The course rejected that timing because the reviewer had not looked yet. The issue was reopened, the same link was resubmitted, and #7 was closed only after the course explicitly confirmed review. Future review tasks must stay open until that evidence arrives.
