// Claude usage provider. Reads the OAuth token the `claude` CLI keeps fresh in the
// macOS Keychain (falling back to the on-disk credentials file), fetches usage from
// Anthropic's internal oauth/usage endpoint, and normalizes it into bars.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { readKeychain } = require('../lib/keychain');
const { toUnixSeconds } = require('../lib/time');

const FABLE_RE = /opus|fable/i;

// Pure: response JSON in, Bars out. No I/O.
function parseClaude(json) {
  if (!json || (json.five_hour == null && json.seven_day == null)) {
    return { ok: false, e: 'err' };
  }

  const bars = [];

  bars.push({
    l: '5h',
    p: json.five_hour ? json.five_hour.utilization : -1,
    r: json.five_hour ? toUnixSeconds(json.five_hour.resets_at) : 0,
  });

  bars.push({
    l: '7d',
    p: json.seven_day ? json.seven_day.utilization : -1,
    r: json.seven_day ? toUnixSeconds(json.seven_day.resets_at) : 0,
  });

  const limits = Array.isArray(json.limits) ? json.limits : [];
  const fable = limits.find(
    (l) =>
      l &&
      l.group === 'weekly' &&
      l.kind === 'weekly_scoped' &&
      l.scope &&
      l.scope.model &&
      FABLE_RE.test(String(l.scope.model.display_name))
  );

  if (fable) {
    bars.push({ l: 'Fable', p: fable.percent, r: toUnixSeconds(fable.resets_at) });
  } else if (json.seven_day_opus) {
    bars.push({
      l: 'Fable',
      p: json.seven_day_opus.utilization,
      r: toUnixSeconds(json.seven_day_opus.resets_at),
    });
  } else {
    bars.push({ l: 'Fable', p: -1, r: 0 });
  }

  return { ok: true, bars };
}

function readToken() {
  const user = os.userInfo().username;
  const fromKeychain = readKeychain('Claude Code-credentials', user);
  let raw = fromKeychain;
  if (!raw) {
    try {
      raw = fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8');
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return (parsed && parsed.claudeAiOauth && parsed.claudeAiOauth.accessToken) || null;
  } catch {
    return null;
  }
}

async function fetchClaude() {
  try {
    const token = readToken();
    if (!token) return { n: 'Claude', ok: false, bars: [], e: 'reauth' };

    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.1.0',
      },
    });

    if (res.status === 401) return { n: 'Claude', ok: false, bars: [], e: 'reauth' };
    if (res.status === 429) return { n: 'Claude', ok: false, bars: [], e: 'stale' };
    if (!res.ok) return { n: 'Claude', ok: false, bars: [], e: 'err' };

    const body = await res.json();
    const parsed = parseClaude(body);
    if (!parsed.ok) return { n: 'Claude', ok: false, bars: [], e: parsed.e };
    return { n: 'Claude', ok: true, bars: parsed.bars };
  } catch {
    return { n: 'Claude', ok: false, bars: [], e: 'err' };
  }
}

module.exports = { parseClaude, fetchClaude };
