const assert = require('node:assert');
const { toFrame } = require('./push');

assert.deepStrictEqual(toFrame({ ok: false }), { ok: 0 });

assert.deepStrictEqual(
  toFrame({
    ok: true,
    session: { pct: 5, reset: 'Jul 8 6:19pm' },
    week: { pct: 59, reset: 'Jul 10 3am' },
    fable: { pct: 82, reset: 'Jul 10 3am' },
  }),
  {
    s: { p: 5, r: 'Jul 8 6:19pm' },
    w: { p: 59, r: 'Jul 10 3am' },
    f: { p: 82, r: 'Jul 10 3am' },
    ok: 1,
  }
);

console.log('push: all assertions passed');
