import type { NightDigest } from '../digest/types.js';

export function Digest({ night, digest }: { night: string; digest: NightDigest }) {
  return (
    <>
      <h1>digest · {night}</h1>
      {digest.badLines > 0 && (
        <p class="warn">
          {digest.badLines} bad {digest.badLines === 1 ? 'line' : 'lines'} skipped; the digest includes valid records only.
        </p>
      )}
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <div class="digest-scroll" role="region" aria-label="Night digest" tabIndex={0}>
          <table class="digest-table">
            <thead>
              <tr>
                <th scope="col">job</th>
                <th scope="col">owner</th>
                <th scope="col">runs</th>
                <th scope="col">retries</th>
                <th scope="col">last status</th>
                <th scope="col">last error</th>
                <th scope="col">first at</th>
                <th scope="col">last at</th>
              </tr>
            </thead>
            <tbody>
              {digest.rows.map((row) => (
                <tr>
                  <th scope="row">{row.job}</th>
                  <td>{row.owner ?? '—'}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries >= 3 ? <strong class="warn">{row.retries}</strong> : row.retries}</td>
                  <td>{row.lastStatus === 'fail' ? <strong class="warn">fail</strong> : row.lastStatus}</td>
                  <td class="digest-error">{row.lastError ?? '—'}</td>
                  <td class="digest-time"><time dateTime={row.firstAt}>{row.firstAt}</time></td>
                  <td class="digest-time"><time dateTime={row.lastAt}>{row.lastAt}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
