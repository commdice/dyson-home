// Simple read-only dashboard at /admin.

const esc = (s) =>
  String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

const OUTCOME_LABEL = { answered: 'Answered', missed: 'Missed', after_hours: 'After hours', ringing: 'Ringing…' };
const SKIP_LABEL = {
  cooldown: 'Already texted recently',
  no_caller_id: 'No caller ID',
  internal_number: 'Staff number',
  send_failed: 'Text failed',
};

export function renderAdmin(config, db) {
  const s = db.stats() || {};
  const calls = db.recentCalls(100);
  const messages = db.recentMessages(100);

  const callRows = calls
    .map(
      (c) => `<tr>
        <td>${esc(c.created_at)} UTC</td><td>${esc(c.from_number)}</td>
        <td><span class="pill ${esc(c.outcome)}">${esc(OUTCOME_LABEL[c.outcome] || c.outcome)}</span></td>
        <td>${c.texted ? 'Texted ✓' : esc(SKIP_LABEL[c.skip_reason] || '—')}</td></tr>`,
    )
    .join('');

  const msgRows = messages
    .map(
      (m) => `<tr>
        <td>${esc(m.created_at)} UTC</td><td>${m.direction === 'in' ? '← from' : '→ to'} ${esc(m.number)}</td>
        <td class="body">${esc(m.body)}</td><td>${esc(m.status)}</td></tr>`,
    )
    .join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Missed Call Text Back</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --text:#1d2330; --muted:#667085; --line:#e4e7ec; --accent:#2563eb;
          --ok:#e7f6ec; --okt:#14532d; --bad:#fdecec; --badt:#7f1d1d; --warn:#fff4e0; --warnt:#7a4b00; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1218; --card:#181c24; --text:#e6e8ec; --muted:#98a2b3; --line:#2a303b;
          --ok:#12301e; --okt:#9ee6b4; --bad:#3a1717; --badt:#f5b1b1; --warn:#3a2a10; --warnt:#f5cf8a; } }
  body { margin:0; font:15px/1.45 system-ui,sans-serif; background:var(--bg); color:var(--text); }
  main { max-width:1000px; margin:0 auto; padding:24px 16px; }
  h1 { margin:0 0 4px; font-size:22px } .sub { color:var(--muted); margin:0 0 20px }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:24px }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px }
  .stat b { display:block; font-size:26px } .stat span { color:var(--muted); font-size:13px }
  section { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:20px; overflow-x:auto }
  h2 { font-size:16px; margin:0 0 10px } table { width:100%; border-collapse:collapse }
  th,td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); vertical-align:top; font-size:14px }
  th { color:var(--muted); font-weight:600 } td.body { white-space:pre-wrap; max-width:420px }
  .pill { padding:2px 8px; border-radius:99px; font-size:12px; font-weight:600 }
  .answered { background:var(--ok); color:var(--okt) } .missed { background:var(--bad); color:var(--badt) }
  .after_hours,.ringing { background:var(--warn); color:var(--warnt) }
</style></head><body><main>
<h1>${esc(config.business.name)} · Missed Call Text Back</h1>
<p class="sub">Last 30 days. Page refreshes every minute.</p>
<div class="stats">
  <div class="stat"><b>${s.answered || 0}</b><span>Calls answered</span></div>
  <div class="stat"><b>${s.missed || 0}</b><span>Calls missed</span></div>
  <div class="stat"><b>${s.texted || 0}</b><span>Callers texted back</span></div>
  <div class="stat"><b>${s.replies || 0}</b><span>Customer replies</span></div>
</div>
<section><h2>Recent calls</h2><table><thead><tr><th>When</th><th>Caller</th><th>Result</th><th>Text back</th></tr></thead>
<tbody>${callRows || '<tr><td colspan="4">No calls yet.</td></tr>'}</tbody></table></section>
<section><h2>Recent texts</h2><table><thead><tr><th>When</th><th>Who</th><th>Message</th><th>Status</th></tr></thead>
<tbody>${msgRows || '<tr><td colspan="4">No texts yet.</td></tr>'}</tbody></table></section>
</main></body></html>`;
}
