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
  const overall = iu.overall || {};
  const teamPooled = (json.teamUsage && json.teamUsage.pooled) || {};

  const reset = toUnixSeconds(json.billingCycleEnd);

  let total = -1;
  if (isNum(plan.totalPercentUsed)) {
    total = plan.totalPercentUsed;
  } else if (isNum(plan.autoPercentUsed) && isNum(plan.apiPercentUsed)) {
    total = (plan.autoPercentUsed + plan.apiPercentUsed) / 2;
  } else if (isNum(plan.used) && isNum(plan.limit) && plan.limit !== 0) {
    total = (plan.used / plan.limit) * 100;
  } else if (isNum(overall.used) && isNum(overall.limit) && overall.limit !== 0) {
    total = (overall.used / overall.limit) * 100;
  } else if (isNum(teamPooled.used) && isNum(teamPooled.limit) && teamPooled.limit !== 0) {
    total = (teamPooled.used / teamPooled.limit) * 100;
  }

  const auto = isNum(plan.autoPercentUsed) ? plan.autoPercentUsed : -1;
  const api = isNum(plan.apiPercentUsed) ? plan.apiPercentUsed : -1;

  return {
    ok: true,
    bars: [
      { l: 'Total', p: total, r: reset },
      { l: 'Auto', p: auto, r: reset },
      { l: 'API', p: api, r: reset },
    ],
  };
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
    return { n: 'Cursor', ok: true, bars: parsed.bars };
  } catch {
    return { n: 'Cursor', ok: false, bars: [], e: 'err' };
  }
}

module.exports = { parseCursor, fetchCursor };
