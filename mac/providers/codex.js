// Codex (ChatGPT/Codex plan rate limits). See docs/superpowers/specs/
// 2026-07-08-m5stack-multi-provider-usage-design.md, "Codex" subsection.
const { toUnixSeconds } = require('../lib/time');

const REFRESH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REFRESH_INTERVAL_MS = 8 * 864e5; // 8 days

// Pure: rate_limit.{primary,secondary}_window -> Parsed. used_percent already
// 0-100; reset_at already unix seconds (toUnixSeconds is a no-op pass-through
// for that case, but keeps us honest if the shape ever carries ISO instead).
function parseCodex(json) {
  const rl = json && json.rate_limit;
  if (!rl) return { ok: false, e: 'err' };

  const primary = rl.primary_window;
  const secondary = rl.secondary_window;

  const bars = [
    {
      l: '5h',
      p: primary && primary.used_percent != null ? primary.used_percent : -1,
      r: primary ? toUnixSeconds(primary.reset_at) : 0,
    },
    {
      l: '7d',
      p: secondary && secondary.used_percent != null ? secondary.used_percent : -1,
      r: secondary ? toUnixSeconds(secondary.reset_at) : 0,
    },
  ];

  return { ok: true, bars };
}

function authPath() {
  const os = require('node:os');
  const path = require('node:path');
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(home, 'auth.json');
}

function readAuth(p) {
  const fs = require('node:fs');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Atomic write: temp file in the same dir, mode 0600, then rename.
function writeAuthAtomic(p, data) {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.dirname(p);
  const tmp = path.join(dir, `.auth.json.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
}

// Refresh access/refresh tokens via auth.openai.com, merge into auth.json,
// write it back atomically. Returns { access_token, auth } or null on failure.
async function refreshCodexToken(p, auth, refreshToken) {
  try {
    const res = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: REFRESH_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: 'openid profile email',
      }),
    });
    if (res.status !== 200) return null;
    const data = await res.json();
    const merged = {
      ...auth,
      tokens: {
        ...auth.tokens,
        access_token: data.access_token,
        refresh_token: data.refresh_token || refreshToken,
        id_token: data.id_token,
      },
      last_refresh: new Date().toISOString(),
    };
    writeAuthAtomic(p, merged);
    return { access_token: data.access_token, auth: merged };
  } catch {
    return null;
  }
}

async function fetchCodex() {
  try {
    const p = authPath();
    let auth;
    try {
      auth = readAuth(p);
    } catch {
      return { n: 'Codex', ok: false, bars: [], e: 'reauth' };
    }

    const tokens = auth.tokens || {};
    let accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const accountId = tokens.account_id;
    if (!accessToken || !refreshToken || !accountId) {
      return { n: 'Codex', ok: false, bars: [], e: 'reauth' };
    }

    const lastRefreshMs = auth.last_refresh ? Date.parse(auth.last_refresh) : NaN;
    if (Number.isNaN(lastRefreshMs) || Date.now() - lastRefreshMs > REFRESH_INTERVAL_MS) {
      const refreshed = await refreshCodexToken(p, auth, refreshToken);
      if (!refreshed) return { n: 'Codex', ok: false, bars: [], e: 'reauth' };
      accessToken = refreshed.access_token;
      auth = refreshed.auth;
    }

    const doFetch = (token) =>
      fetch('https://chatgpt.com/backend-api/wham/usage', {
        headers: {
          Authorization: `Bearer ${token}`,
          'ChatGPT-Account-Id': accountId,
          Accept: 'application/json',
        },
      });

    let res = await doFetch(accessToken);
    if (res.status === 401 || res.status === 403) {
      const refreshed = await refreshCodexToken(p, auth, refreshToken);
      if (!refreshed) return { n: 'Codex', ok: false, bars: [], e: 'reauth' };
      accessToken = refreshed.access_token;
      res = await doFetch(accessToken);
      if (res.status === 401 || res.status === 403) {
        return { n: 'Codex', ok: false, bars: [], e: 'reauth' };
      }
    }

    if (res.status !== 200) return { n: 'Codex', ok: false, bars: [], e: 'err' };

    const body = await res.json();
    const parsed = parseCodex(body);
    if (!parsed.ok) return { n: 'Codex', ok: false, bars: [], e: parsed.e };
    return { n: 'Codex', ok: true, bars: parsed.bars };
  } catch {
    return { n: 'Codex', ok: false, bars: [], e: 'err' };
  }
}

module.exports = { parseCodex, fetchCodex };
