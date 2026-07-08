const assert = require('node:assert');
const { buildFrame } = require('./frame');

const windows = [
  { n: 'Claude', ok: true, bars: [
    { l: '5h', p: 73.4, r: 1751998800.6 },
    { l: 'Fable', p: -1, r: 0 },
    { l: '7d', p: 130, r: 1752566400 },
  ] },
  { n: 'Grok', ok: false, e: 'reauth', bars: [] },
];

const f = buildFrame(windows, 1751990400.9);

assert.strictEqual(f.v, 1);
assert.strictEqual(f.ts, 1751990401, 'ts rounded');
assert.strictEqual(f.w.length, 2);

const c = f.w[0];
assert.strictEqual(c.ok, 1);
assert.strictEqual(c.b[0].p, 73, 'float pct rounded');
assert.strictEqual(c.b[0].r, 1751998801, 'reset rounded to int');
assert.strictEqual(c.b[1].p, -1, 'unknown stays -1');
assert.strictEqual(c.b[2].p, 100, 'over-100 clamped');

const g = f.w[1];
assert.deepStrictEqual(g, { n: 'Grok', ok: 0, e: 'reauth', b: [] });

console.log('frame: all assertions passed');
