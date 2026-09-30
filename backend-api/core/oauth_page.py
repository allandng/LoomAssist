"""Self-contained HTML page served at the OAuth redirect URIs.

Both Supabase (tokens in the URL *fragment*) and Google (authorization
`code` in the *query*) redirect the system browser back to the backend. The
backend cannot see a fragment server-side, so the page carries a few lines
of JavaScript that:

  1. read `location.search` **and** `location.hash` into one param map,
  2. POST the relevant fields to the existing completion endpoint
     (``/auth/oauth/complete`` or ``/connections/google/complete``) on the
     same origin — no CORS involved,
  3. tell the user to return to the LoomAssist window.

No external assets, works offline, dark/light aware.
"""
from __future__ import annotations

import json

_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LoomAssist — __TITLE__</title>
<style>
  :root { color-scheme: light dark; --bg:#0f1117; --panel:#171a23; --text:#e6e8ef; --muted:#9aa1b2; --accent:#6366f1; --ok:#22c55e; --err:#ef4444; --border:#262a36; }
  @media (prefers-color-scheme: light) { :root { --bg:#f7f7fb; --panel:#ffffff; --text:#111827; --muted:#6b7280; --border:#e5e7eb; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; padding:16px; }
  .card { width:100%; max-width:440px; background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:32px 28px; text-align:center; box-shadow:0 10px 30px rgba(0,0,0,.18); }
  .logo { width:44px; height:44px; border-radius:12px; margin:0 auto 18px; background:var(--accent); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:20px; }
  h1 { font-size:1.25rem; margin:0 0 8px; }
  p { margin:0; color:var(--muted); word-break:break-word; }
  .spinner { width:28px; height:28px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; margin:18px auto 0; animation:spin .9s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .hint { margin-top:20px; font-size:.9rem; }
  .ok   { color:var(--ok); }
  .err  { color:var(--err); }
  code { font-size:.85em; background:var(--bg); padding:2px 6px; border-radius:6px; }
</style>
</head>
<body>
  <div class="card" role="status" aria-live="polite">
    <div class="logo">L</div>
    <h1 id="h">Finishing up…</h1>
    <p id="p">Talking to LoomAssist on this computer.</p>
    <div class="spinner" id="spinner"></div>
    <p class="hint" id="hint" hidden>You can close this tab and return to the LoomAssist window.</p>
  </div>
<script>
(function () {
  var KIND = __KIND__;
  var COMPLETE = __COMPLETE__;
  var h = document.getElementById('h'), p = document.getElementById('p');
  var spinner = document.getElementById('spinner'), hint = document.getElementById('hint');

  function params() {
    var out = {};
    function add(s) {
      if (!s) return;
      s = s.replace(/^[#?]/, '');
      s.split('&').forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('=');
        var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
        var v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\\+/g, ' '));
        if (!(k in out)) out[k] = v;
      });
    }
    add(location.search);
    add(location.hash);
    return out;
  }

  function show(title, msg, ok) {
    h.textContent = title;
    h.className = ok ? 'ok' : 'err';
    p.textContent = msg || '';
    spinner.hidden = true;
    hint.hidden = false;
    if (!ok) hint.textContent = 'Return to LoomAssist and try again.';
  }

  var q = params();
  if (q.error || q.error_description) {
    show('Sign-in failed', q.error_description || q.error, false);
    return;
  }

  var body;
  if (KIND === 'google') {
    if (!q.code) { show('Missing authorization code', 'The provider did not send a code back.', false); return; }
    body = { code: q.code };
  } else {
    if (!q.access_token) { show('Missing token', 'The provider did not send an access token back.', false); return; }
    body = { access_token: q.access_token, refresh_token: q.refresh_token || null, provider: q.provider || null };
  }

  fetch(COMPLETE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) {} return { ok: r.ok, status: r.status, j: j, t: t }; }); })
    .then(function (res) {
      if (!res.ok) {
        var d = res.j && res.j.detail;
        var msg = (d && d.error && (d.error.detail || d.error.code)) || (res.j && res.j.message) || res.t || ('HTTP ' + res.status);
        show('Could not complete', String(msg).slice(0, 300), false);
        return;
      }
      var who = (res.j && (res.j.email || res.j.account_email || res.j.display_name)) || '';
      show(KIND === 'google' ? 'Google Calendar connected' : 'Signed in', who ? 'Account: ' + who : 'All set.', true);
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
    })
    .catch(function (e) { show('Could not reach LoomAssist', 'Is the app running? ' + String(e), false); });
})();
</script>
</body>
</html>
"""


def render_oauth_callback_page(*, kind: str, complete_path: str, title: str) -> str:
    """kind: 'google' (code in query) or 'supabase' (tokens in fragment)."""
    return (_TEMPLATE
            .replace("__TITLE__", title.replace("<", "&lt;"))
            .replace("__KIND__", json.dumps(kind))
            .replace("__COMPLETE__", json.dumps(complete_path)))
