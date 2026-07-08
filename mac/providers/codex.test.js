const assert = require('node:assert');
const { parseCodex } = require('./codex');

// Fixture: synthetic rate_limit with both windows populated.
const fixture = require('../fixtures/codex.json');

{
  const parsed = parseCodex(fixture);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.bars.length, 2);

  const [fiveHour, sevenDay] = parsed.bars;
  assert.strictEqual(fiveHour.l, '5h');
  assert.strictEqual(fiveHour.p, 12);
  assert.strictEqual(fiveHour.r, 1751995200);

  assert.strictEqual(sevenDay.l, '7d');
  assert.strictEqual(sevenDay.p, 55.5);
  assert.strictEqual(sevenDay.r, 1752560000);
}

// Missing rate_limit entirely -> {ok:false, e:'err'}.
{
  const parsed = parseCodex({});
  assert.strictEqual(parsed.ok, false);
  assert.strictEqual(parsed.e, 'err');
}

// A missing window -> that bar's p is -1, r is 0.
{
  const parsed = parseCodex({
    rate_limit: {
      primary_window: { used_percent: 42, reset_at: 1751995200 },
    },
  });
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.bars.length, 2);
  assert.strictEqual(parsed.bars[0].p, 42);
  assert.strictEqual(parsed.bars[1].l, '7d');
  assert.strictEqual(parsed.bars[1].p, -1);
  assert.strictEqual(parsed.bars[1].r, 0);
}

console.log('PASS providers/codex.test.js');
