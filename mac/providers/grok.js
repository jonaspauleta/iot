// Grok (xAI) usage window. Parses the gRPC-web GrokBuildBilling response into
// a single "Credits" bar; fetches it from grok.com using the token cached by
// the `grok` CLI in ~/.grok/auth.json.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseFrames, scanProtobuf, findField } = require('../lib/grpcweb');

// A future-year sanity bound (year ~2100) so a stray large varint never gets
// mistaken for a plausible reset/expiry timestamp.
const FAR_FUTURE_SEC = 4102444800;

function findUsedPercentFloat(fields) {
  for (const f of fields) {
    if (f.wire === 5 && f.path[f.path.length - 1] === 1) {
      const v = f.value;
      if (typeof v === 'number' && v >= 0 && v <= 100) return v;
    }
  }
  return undefined;
}

function hasFutureVarint(fields, nowSec) {
  return fields.some((f) => {
    if (f.wire !== 0 || typeof f.value !== 'bigint') return false;
    const v = Number(f.value);
    return v > nowSec && v < FAR_FUTURE_SEC;
  });
}

// PURE: buf -> Parsed. No I/O.
function parseGrok(buf) {
  try {
    const { data, trailers } = parseFrames(buf);
    for (const t of trailers) {
      const m = /grpc-status:\s*(\d+)/i.exec(t);
      if (m && m[1] !== '0') return { ok: false, e: 'reauth' };
    }
    if (!data.length) return { ok: false, e: 'err' };

    const fields = scanProtobuf(data[0]);
    if (!fields.length) return { ok: false, e: 'err' };

    let usedPercent = findUsedPercentFloat(fields);
    if (usedPercent === undefined) {
      const marker = findField(fields, [1, 8, 1]);
      const markerVal =
        marker && typeof marker.value === 'bigint' ? Number(marker.value) : undefined;
      const nowSec = Math.floor(Date.now() / 1000);
      if ((markerVal === 1 || markerVal === 2) && hasFutureVarint(fields, nowSec)) {
        usedPercent = 0;
      } else {
        usedPercent = -1;
      }
    }

    const resetField = findField(fields, [1, 5, 1]);
    const reset = resetField ? Number(resetField.value) : 0;

    return { ok: true, bars: [{ l: 'Credits', p: usedPercent, r: reset }] };
  } catch {
    return { ok: false, e: 'err' };
  }
}

function readAuth() {
  const home = process.env.GROK_HOME || path.join(os.homedir(), '.grok');
  const authPath = path.join(home, 'auth.json');
  const raw = fs.readFileSync(authPath, 'utf8');
  return JSON.parse(raw);
}

function pickEntry(auth) {
  for (const [k, v] of Object.entries(auth || {})) {
    if (k.startsWith('https://auth.x.ai::')) return v;
  }
  return auth && auth['https://accounts.x.ai/sign-in'];
}

async function fetchGrok() {
  const name = 'Grok';
  try {
    let auth;
    try {
      auth = readAuth();
    } catch {
      return { n: name, ok: false, bars: [], e: 'reauth' };
    }

    const entry = pickEntry(auth);
    if (!entry || !entry.key) return { n: name, ok: false, bars: [], e: 'reauth' };

    if (!entry.expires_at || Date.parse(entry.expires_at) <= Date.now()) {
      return { n: name, ok: false, bars: [], e: 'stale' };
    }

    const res = await fetch(
      'https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${entry.key}`,
          'Content-Type': 'application/grpc-web+proto',
          'x-grpc-web': '1',
          Origin: 'https://grok.com',
          Referer: 'https://grok.com/?_s=usage',
          Accept: '*/*',
          'x-user-agent': 'connect-es/2.1.1',
        },
        body: Buffer.from([0, 0, 0, 0, 0]),
      }
    );
    if (!res.ok) return { n: name, ok: false, bars: [], e: 'err' };

    const buf = Buffer.from(await res.arrayBuffer());
    const parsed = parseGrok(buf);
    if (!parsed.ok) return { n: name, ok: false, bars: [], e: parsed.e };
    return { n: name, ok: true, bars: parsed.bars };
  } catch {
    return { n: name, ok: false, bars: [], e: 'err' };
  }
}

module.exports = { parseGrok, fetchGrok };
