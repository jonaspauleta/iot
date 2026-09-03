const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const keychain = require('../lib/keychain');

const keychainCalls = [];
let keychainValues = new Map();
const originalReadKeychain = keychain.readKeychain;
keychain.readKeychain = (service, account) => {
  keychainCalls.push({ service, account });
  return keychainValues.get(service) || null;
};

const { parseClaude, fetchClaude, claudeCredentialsPath, claudeKeychainService } = require('./claude');

const fixture = require(path.join(__dirname, '..', 'fixtures', 'claude.json'));
const noFableFixture = require(path.join(__dirname, '..', 'fixtures', 'claude-no-fable.json'));

function profileKeychainService(configDir) {
  const suffix = crypto
    .createHash('sha256')
    .update(configDir.normalize('NFC'))
    .digest('hex')
    .slice(0, 8);
  return `Claude Code-credentials-${suffix}`;
}

function credentials(token) {
  return JSON.stringify({ claudeAiOauth: { accessToken: token } });
}

function setKeychainValues(values) {
  keychainCalls.length = 0;
  keychainValues = new Map(Object.entries(values));
}

const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
try {
  delete process.env.CLAUDE_CONFIG_DIR;
  assert.strictEqual(
    claudeCredentialsPath(),
    path.join(os.homedir(), '.claude-voltimum', '.credentials.json')
  );

  process.env.CLAUDE_CONFIG_DIR = '/tmp/m5-usage-claude-profile';
  assert.strictEqual(
    claudeCredentialsPath(),
    path.join('/tmp/m5-usage-claude-profile', '.credentials.json')
  );
  assert.strictEqual(
    claudeKeychainService(),
    'Claude Code-credentials-4ac010a9'
  );

  process.env.CLAUDE_CONFIG_DIR = '';
  assert.strictEqual(
    claudeCredentialsPath(),
    path.join(os.homedir(), '.claude-voltimum', '.credentials.json')
  );
  assert.strictEqual(
    claudeKeychainService(),
    profileKeychainService(path.join(os.homedir(), '.claude-voltimum'))
  );

  process.env.CLAUDE_CONFIG_DIR = '   ';
  assert.strictEqual(
    claudeCredentialsPath(),
    path.join(os.homedir(), '.claude-voltimum', '.credentials.json')
  );
  assert.strictEqual(
    claudeKeychainService(),
    profileKeychainService(path.join(os.homedir(), '.claude-voltimum'))
  );
} finally {
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
  }
}

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

const originalFetch = global.fetch;
const originalClaudeConfigDirForCredentialTests = process.env.CLAUDE_CONFIG_DIR;

async function testCredentialSources() {
  let authorization;
  global.fetch = async (_url, options) => {
    authorization = options.headers.Authorization;
    return {
      ok: true,
      status: 200,
      json: async () => fixture,
    };
  };

  const customProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-usage-claude-'));
  try {
    const customService = profileKeychainService(customProfile);
    process.env.CLAUDE_CONFIG_DIR = customProfile;
    setKeychainValues({ [customService]: credentials('scoped-token') });

    let result = await fetchClaude();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(authorization, 'Bearer scoped-token');
    assert.deepStrictEqual(
      keychainCalls.map((call) => call.service),
      [customService]
    );

    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-usage-claude-'));
    try {
      fs.writeFileSync(
        path.join(profileDir, '.credentials.json'),
        credentials('file-token')
      );
      process.env.CLAUDE_CONFIG_DIR = profileDir;
      setKeychainValues({
        [profileKeychainService(profileDir)]: credentials('keychain-token'),
      });

      result = await fetchClaude();
      assert.strictEqual(result.ok, true);
      assert.strictEqual(authorization, 'Bearer file-token');
      assert.deepStrictEqual(keychainCalls, []);

      fs.writeFileSync(path.join(profileDir, '.credentials.json'), '{malformed');
      setKeychainValues({
        [profileKeychainService(profileDir)]: credentials('scoped-fallback-token'),
      });

      result = await fetchClaude();
      assert.strictEqual(result.ok, true);
      assert.strictEqual(authorization, 'Bearer scoped-fallback-token');
    } finally {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }

    process.env.CLAUDE_CONFIG_DIR = customProfile;
    setKeychainValues({
      [customService]: null,
      'Claude Code-credentials': credentials('legacy-token'),
    });
    result = await fetchClaude();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(authorization, 'Bearer legacy-token');
    assert.deepStrictEqual(
      keychainCalls.map((call) => call.service),
      [customService, 'Claude Code-credentials']
    );

    setKeychainValues({
      [customService]: JSON.stringify({ claudeAiOauth: { accessToken: { invalid: true } } }),
      'Claude Code-credentials': credentials('legacy-after-invalid-token'),
    });
    result = await fetchClaude();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(authorization, 'Bearer legacy-after-invalid-token');

    setKeychainValues({});
    result = await fetchClaude();
    assert.deepStrictEqual(result, { n: 'Claude', ok: false, bars: [], e: 'reauth' });
  } finally {
    fs.rmSync(customProfile, { recursive: true, force: true });
  }
}

testCredentialSources()
  .then(() => console.log('claude: all assertions passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    keychain.readKeychain = originalReadKeychain;
    global.fetch = originalFetch;
    if (originalClaudeConfigDirForCredentialTests === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDirForCredentialTests;
    }
  });
