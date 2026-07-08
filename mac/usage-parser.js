// Pure parser for `claude -p "/usage"` output. No I/O.

const RE = {
  session: /Current session:\s*(\d+)%\s*used\b.*?\bresets\s+(.+)/i,
  week: /Current week \(all models\):\s*(\d+)%\s*used\b.*?\bresets\s+(.+)/i,
  fable: /Current week \(Fable\):\s*(\d+)%\s*used\b.*?\bresets\s+(.+)/i,
};

function cleanReset(s) {
  return s
    .replace(/\s*\([^)]*\)\s*$/, '') // drop trailing " (Timezone)"
    .replace(/\bat\b/i, ' ') // drop the word "at"
    .replace(/\s+/g, ' ')
    .trim();
}

function one(text, re) {
  const m = text.match(re);
  if (!m) return null;
  return { pct: parseInt(m[1], 10), reset: cleanReset(m[2]) };
}

function parse(text) {
  const session = one(text, RE.session);
  const week = one(text, RE.week);
  const fable = one(text, RE.fable);
  if (!session || !week || !fable) return { ok: false };
  return { ok: true, session, week, fable };
}

module.exports = { parse, cleanReset };
