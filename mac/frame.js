// Normalize an array of provider Windows into the compact serial frame the
// firmware renders. Rounds/clamps percents, coerces resets to int unix seconds,
// and shapes degraded windows. Pure, no I/O.

function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}

function mapBar(b) {
  const p = b.p === -1 || b.p == null ? -1 : clamp(Math.round(b.p), 0, 100);
  return { l: String(b.l), p, r: Math.round(b.r || 0) };
}

function mapWindow(w) {
  const out = { n: w.n, ok: w.ok ? 1 : 0 };
  if (!w.ok && w.e) out.e = w.e;
  out.b = (w.bars || []).map(mapBar);
  return out;
}

function buildFrame(windows, nowSec) {
  return { v: 1, ts: Math.round(nowSec), w: windows.map(mapWindow) };
}

module.exports = { buildFrame };
