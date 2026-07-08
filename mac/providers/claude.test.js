const assert = require('node:assert');
const path = require('node:path');
const { parseClaude } = require('./claude');

const fixture = require(path.join(__dirname, '..', 'fixtures', 'claude.json'));
const noFableFixture = require(path.join(__dirname, '..', 'fixtures', 'claude-no-fable.json'));

// Full fixture: five_hour, seven_day, and a limits[] Fable entry.
const parsed = parseClaude(fixture);
assert.strictEqual(parsed.ok, true);
assert.strictEqual(parsed.bars.length, 3);

const [fiveHour, sevenDay, fable] = parsed.bars;

assert.strictEqual(fiveHour.l, '5h');
assert.strictEqual(fiveHour.p, 42.3);
assert.strictEqual(fiveHour.r, Math.round(Date.parse('2026-07-08T18:00:00Z') / 1000));

assert.strictEqual(sevenDay.l, '7d');
assert.strictEqual(sevenDay.p, 68);
assert.strictEqual(sevenDay.r, Math.round(Date.parse('2026-07-15T00:00:00Z') / 1000));

assert.strictEqual(fable.l, 'Fable');
assert.strictEqual(fable.p, 31.7);
assert.strictEqual(fable.r, Math.round(Date.parse('2026-07-15T00:00:00Z') / 1000));

// Fixture missing limits[] and seven_day_opus: Fable bar becomes p:-1, r:0.
const parsedNoFable = parseClaude(noFableFixture);
assert.strictEqual(parsedNoFable.ok, true);
assert.strictEqual(parsedNoFable.bars.length, 3);
assert.strictEqual(parsedNoFable.bars[2].l, 'Fable');
assert.strictEqual(parsedNoFable.bars[2].p, -1);
assert.strictEqual(parsedNoFable.bars[2].r, 0);

// seven_day_opus fallback path (no limits[] Fable match, but seven_day_opus present).
const opusFallback = parseClaude({
  five_hour: { utilization: 5, resets_at: '2026-07-08T18:00:00Z' },
  seven_day: { utilization: 6, resets_at: '2026-07-15T00:00:00Z' },
  seven_day_opus: { utilization: 19.5, resets_at: '2026-07-15T00:00:00Z' },
});
assert.strictEqual(opusFallback.ok, true);
assert.strictEqual(opusFallback.bars[2].l, 'Fable');
assert.strictEqual(opusFallback.bars[2].p, 19.5);
assert.strictEqual(opusFallback.bars[2].r, Math.round(Date.parse('2026-07-15T00:00:00Z') / 1000));

// Fully absent expected fields -> {ok:false, e:'err'}.
const empty = parseClaude({});
assert.strictEqual(empty.ok, false);
assert.strictEqual(empty.e, 'err');

console.log('claude: all assertions passed');
