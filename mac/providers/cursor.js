// Cursor usage: Keychain JWT -> derived WorkOS session cookie -> usage-summary bars.
const { readKeychain } = require('../lib/keychain');
const { decodeJwt } = require('../lib/jwt');
const { toUnixSeconds } = require('../lib/time');

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// PURE: response JSON in, bars out. No I/O.
function parseCursor(json) {
  if (!json || (!json.individualUsage && !json.teamUsage)) {
    return { ok: false, e: 'err' };
  }

  const iu = json.individualUsage || {};
  const plan = iu.plan || {};
  const reset = toUnixSeconds(json.billingCycleEnd);

  return {
    ok: true,
    bars: [
      {
        l: '1st party models',
        p: isNum(plan.autoPercentUsed) ? plan.autoPercentUsed : -1,
        r: reset,
      },
      {
        l: '3rd party models',
        p: isNum(plan.apiPercentUsed) ? plan.apiPercentUsed : -1,
        r: reset,
      },
      { l: 'grok bot', p: -1, r: 0 },
    ],
  };
}

// PURE: optional Cursor Bot response in, one bar value out. No I/O.
function parseCursorBot(json) {
  if (!json || !isNum(json.usagePercent)) return { p: -1, r: 0 };
  return {
    p: json.usagePercent,
    r: toUnixSeconds(json.nextResetTimestampUtc),
  };
}

async function fetchCursorBot(cookie, request = fetch) {
  try {
    const res = await request('https://cursor.com/api/dashboard/get-sand-usage-status', {
      method: 'POST',
      headers: { Cookie: cookie, Accept: 'application/json' },
    });
    if (!res.ok) return parseCursorBot();
    return parseCursorBot(await res.json());
  } catch {
    return parseCursorBot();
  }
}

// Reads Keychain creds + HTTP + parse<P>. Never throws.
async function fetchCursor() {
  try {
    const token = readKeychain('cursor-access-token', 'cursor-user');
    if (!token) return { n: 'Cursor', ok: false, bars: [], e: 'reauth' };

    let claims;
    try {
      claims = decodeJwt(token);
    } catch {
      return { n: 'Cursor', ok: false, bars: [], e: 'reauth' };
    }

    const now = Date.now() / 1000;
    if (!isNum(claims.exp) || claims.exp - now < 300) {
      return { n: 'Cursor', ok: false, bars: [], e: 'reauth' };
    }

    const userId = String(claims.sub).split('|').pop();
    // Send %3A%3A literally, do not re-encode.
    const cookie = `WorkosCursorSessionToken=${userId}%3A%3A${token}`;

    const res = await fetch('https://cursor.com/api/usage-summary', {
      headers: { Cookie: cookie, Accept: 'application/json' },
    });

    if (res.status === 401 || res.status === 403) {
      return { n: 'Cursor', ok: false, bars: [], e: 'reauth' };
    }
    if (!res.ok) {
      return { n: 'Cursor', ok: false, bars: [], e: 'err' };
    }

    const body = await res.json();
    const parsed = parseCursor(body);
    if (!parsed.ok) return { n: 'Cursor', ok: false, bars: [], e: parsed.e };
    const bot = await fetchCursorBot(cookie);
    return {
      n: 'Cursor',
      ok: true,
      bars: [parsed.bars[0], parsed.bars[1], { ...parsed.bars[2], ...bot }],
    };
  } catch {
    return { n: 'Cursor', ok: false, bars: [], e: 'err' };
  }
}

module.exports = { parseCursor, parseCursorBot, fetchCursorBot, fetchCursor };
