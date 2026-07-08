const assert = require('node:assert');
const path = require('node:path');
const { parseCursor } = require('./cursor');

const modernFixture = require(path.join(__dirname, '..', 'fixtures', 'cursor.json'));
const legacyFixture = require(path.join(__dirname, '..', 'fixtures', 'cursor-legacy.json'));

// Modern fixture: individualUsage.plan.{totalPercentUsed,autoPercentUsed,apiPercentUsed}
// + billingCycleEnd -> 3 bars, shared reset.
{
  const parsed = parseCursor(modernFixture);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.bars.length, 3);

  const [total, auto, api] = parsed.bars;
  assert.strictEqual(total.l, 'Total');
  assert.strictEqual(total.p, 73.2);
  assert.strictEqual(auto.l, 'Auto');
  assert.strictEqual(auto.p, 60.1);
  assert.strictEqual(api.l, 'API');
  assert.strictEqual(api.p, 13.4);

  const expectedReset = 1754006400; // toUnixSeconds('2025-08-01T00:00:00Z')
  assert.strictEqual(total.r, expectedReset);
  assert.strictEqual(auto.r, expectedReset);
  assert.strictEqual(api.r, expectedReset);
}

// Legacy fixture: no *PercentUsed, but plan.used/plan.limit -> Total falls back to
// the ratio, Auto/API stay -1 (unknown).
{
  const parsed = parseCursor(legacyFixture);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.bars.length, 3);

  const [total, auto, api] = parsed.bars;
  assert.strictEqual(total.l, 'Total');
  assert.strictEqual(total.p, 45); // 450/1000*100
  assert.strictEqual(auto.l, 'Auto');
  assert.strictEqual(auto.p, -1);
  assert.strictEqual(api.l, 'API');
  assert.strictEqual(api.p, -1);

  const expectedReset = 1754006400;
  assert.strictEqual(total.r, expectedReset);
}

// No individualUsage/teamUsage at all -> {ok:false, e:'err'}.
{
  const parsed = parseCursor({});
  assert.strictEqual(parsed.ok, false);
  assert.strictEqual(parsed.e, 'err');
}

console.log('PASS providers/cursor.test.js');
