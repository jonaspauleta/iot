const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parse, cleanReset } = require('./usage-parser');

const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'usage.txt'), 'utf8');
const r = parse(sample);

assert.strictEqual(r.ok, true, 'full sample should parse');
assert.strictEqual(r.session.pct, 5);
assert.strictEqual(r.session.reset, 'Jul 8 6:19pm');
assert.strictEqual(r.week.pct, 59);
assert.strictEqual(r.week.reset, 'Jul 10 3am');
assert.strictEqual(r.fable.pct, 82);
assert.strictEqual(r.fable.reset, 'Jul 10 3am');

// a line missing means not-ok (never show half-stale data as current)
assert.strictEqual(parse('Current session: 5% used · resets 6pm (X)').ok, false);
assert.strictEqual(parse('garbage output').ok, false);

// cleanReset unit behavior
assert.strictEqual(cleanReset('Jul 8 at 6:19pm (Europe/Lisbon)'), 'Jul 8 6:19pm');
assert.strictEqual(cleanReset('Jul 10 at 3am (Europe/Lisbon)'), 'Jul 10 3am');

console.log('usage-parser: all assertions passed');
