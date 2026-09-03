const assert = require('node:assert');
const path = require('node:path');
const { parseCursor, parseCursorBot } = require('./cursor');

const modernFixture = require(path.join(__dirname, '..', 'fixtures', 'cursor.json'));
const legacyFixture = require(path.join(__dirname, '..', 'fixtures', 'cursor-legacy.json'));
const botFixture = require(path.join(__dirname, '..', 'fixtures', 'cursor-bot.json'));
const expectedReset = 1754006400;

// Modern fixture: individualUsage.plan.{autoPercentUsed,apiPercentUsed}
// + billingCycleEnd -> the two core bars and an unknown Bot bar.
{
  const parsed = parseCursor(modernFixture);
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(parsed.bars, [
    { l: '1st party models', p: 60.1, r: expectedReset },
    { l: '3rd party models', p: 13.4, r: expectedReset },
    { l: 'grok bot', p: -1, r: 0 },
  ]);
}

// Legacy fixture: no *PercentUsed values, so both core source bars are unknown.
{
  const parsed = parseCursor(legacyFixture);
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(parsed.bars, [
    { l: '1st party models', p: -1, r: expectedReset },
    { l: '3rd party models', p: -1, r: expectedReset },
    { l: 'grok bot', p: -1, r: 0 },
  ]);
}

// Optional Bot fixture: usagePercent + nextResetTimestampUtc -> one bar value.
{
  const bot = parseCursorBot(botFixture);
  assert.deepStrictEqual(bot, { p: 82.5, r: 1754137800 });
}

// Missing or malformed Bot responses remain unknown.
{
  assert.deepStrictEqual(parseCursorBot({}), { p: -1, r: 0 });
  assert.deepStrictEqual(parseCursorBot({ usagePercent: '82.5' }), { p: -1, r: 0 });
}

// No individualUsage/teamUsage at all -> {ok:false, e:'err'}.
{
  const parsed = parseCursor({});
  assert.strictEqual(parsed.ok, false);
  assert.strictEqual(parsed.e, 'err');
}

console.log('PASS providers/cursor.test.js');
