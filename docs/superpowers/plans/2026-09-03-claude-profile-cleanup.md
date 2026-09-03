# Claude Profile Selection and Runtime Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude usage read the configurable `CLAUDE_CONFIG_DIR` profile, defaulting to `~/.claude-voltimum`, while retaining Codex, Cursor, and Grok and hardening provider collection.

**Architecture:** The Claude provider resolves one profile credentials path, reads that file before its existing Keychain fallback, and never reads the legacy `~/.claude` file. `push.js` keeps a fixed four-provider registry but settles each fetch independently, converting an unexpected rejection into a degraded window before calling the existing frame normalizer. LaunchAgent and documentation changes make the same profile selection visible in foreground and background runs.

**Tech Stack:** Bun 1.3+, CommonJS JavaScript, built-in `fetch`, Node-compatible built-in filesystem modules, macOS `security`, Bash, Arduino/C++ with PlatformIO.

## Global Constraints

- Default Claude profile directory is `$HOME/.claude-voltimum`.
- `CLAUDE_CONFIG_DIR` overrides the Claude profile directory when it is non-empty.
- Claude reads `<profile>/.credentials.json` before the Keychain item `Claude Code-credentials` for the current username.
- Claude never reads `$HOME/.claude/.credentials.json`.
- Codex, Cursor, and Grok remain enabled in the fixed order Claude, Codex, Cursor, Grok.
- No serial frame schema or firmware rendering behavior changes.
- No Claude token refresh or Keychain writes.
- Tokens must never be logged, printed, committed, or placed in fixtures.
- Runtime serial remains dependency-free, hand-rolled with `stty` and a held-open file descriptor.
- Do not create commits or change shared remote state unless the user explicitly requests it.

## File Map

- Modify `mac/providers/claude.js` to resolve the profile path and change credential precedence.
- Modify `mac/providers/claude.test.js` to cover default and overridden profile paths.
- Modify `mac/push.js` to use a fixed provider registry and settled collection helper.
- Create `mac/push.test.js` to cover one provider rejection without losing the other windows.
- Create `pusher.test.sh` to verify XML-safe LaunchAgent profile propagation.
- Modify `mac/package.json` to include the JavaScript and shell regression tests in `bun run test`.
- Modify `pusher.sh` to pass the effective Claude profile into the LaunchAgent environment.
- Modify `firmware/src/main.cpp` to remove the unused `haveGood` field and assignment.
- Modify `README.md` to document the Claude profile and remove the unmatched fence.
- Modify `CLAUDE.md` to document `CLAUDE_CONFIG_DIR`.
- Do not modify the historical July design or implementation documents.

---

### Task 1: Configurable Claude Profile

**Files:**
- Modify: `mac/providers/claude.js`
- Test: `mac/providers/claude.test.js`

**Interfaces:**
- `claudeCredentialsPath() -> string` returns the configured profile's `.credentials.json` path without reading credentials.
- `fetchClaude() -> Promise<Window>` keeps the existing `{ n: 'Claude', ok, bars, e? }` contract.
- `parseClaude(json) -> Parsed` remains unchanged.

- [ ] **Step 1: Add failing profile-path assertions**

In `mac/providers/claude.test.js`, extend the imports and add this environment-safe block before the existing parser assertions:

```js
const os = require('node:os');
const { parseClaude, claudeCredentialsPath } = require('./claude');

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

  process.env.CLAUDE_CONFIG_DIR = '';
  assert.strictEqual(
    claudeCredentialsPath(),
    path.join(os.homedir(), '.claude-voltimum', '.credentials.json')
  );
} finally {
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
  }
}
```

Remove the original `const { parseClaude } = require('./claude');` line so the module is imported only once. Keep the existing fixture assertions below this block unchanged.

- [ ] **Step 2: Run the focused test and verify it fails**

Run from the repository root:

```bash
cd mac
bun providers/claude.test.js
```

Expected result: fail because `claudeCredentialsPath` is not exported yet.

- [ ] **Step 3: Implement profile-first credential resolution**

In `mac/providers/claude.js`, replace the current `readToken()` implementation and add the path helper with this code. Leave `parseClaude()` and `fetchClaude()` unchanged.

```js
function parseToken(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return (parsed && parsed.claudeAiOauth && parsed.claudeAiOauth.accessToken) || null;
  } catch {
    return null;
  }
}

function claudeCredentialsPath() {
  const configured = process.env.CLAUDE_CONFIG_DIR;
  const configDir = configured && configured.trim()
    ? configured
    : path.join(os.homedir(), '.claude-voltimum');
  return path.join(configDir, '.credentials.json');
}

function readToken() {
  let raw = null;
  try {
    raw = fs.readFileSync(claudeCredentialsPath(), 'utf8');
  } catch {
    raw = null;
  }

  const fromProfile = parseToken(raw);
  if (fromProfile) return fromProfile;

  const user = os.userInfo().username;
  return parseToken(readKeychain('Claude Code-credentials', user));
}
```

Export the helper with the existing provider functions:

```js
module.exports = { parseClaude, fetchClaude, claudeCredentialsPath };
```

This deliberately removes the `path.join(os.homedir(), '.claude', '.credentials.json')` fallback. The Keychain fallback remains after the configured profile file, and no credential is written.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd mac
bun providers/claude.test.js
```

Expected result: the existing Claude parser assertions and the new path assertions pass, ending with `claude: all assertions passed`.

---

### Task 2: Isolated Provider Collection

**Files:**
- Modify: `mac/push.js`
- Create: `mac/push.test.js`
- Modify: `mac/package.json`

**Interfaces:**
- `collectWindows(providers) -> Promise<Window[]>` settles the supplied provider descriptors in their supplied order.
- A rejected descriptor becomes `{ n: descriptor.name, ok: false, bars: [], e: 'err' }`.
- `gather() -> Promise<Frame>` uses the production registry `[Claude, Codex, Cursor, Grok]` and the existing `buildFrame()`.

- [ ] **Step 1: Write the failing collection test**

Create `mac/push.test.js` with this synthetic, network-free test:

```js
const assert = require('node:assert');
const { collectWindows } = require('./push');

(async () => {
  const providers = [
    {
      name: 'Claude',
      fetch: async () => ({
        n: 'Claude',
        ok: true,
        bars: [{ l: '5h', p: 10, r: 0 }],
      }),
    },
    {
      name: 'Codex',
      fetch: () => {
        throw new Error('synthetic provider failure');
      },
    },
    {
      name: 'Cursor',
      fetch: async () => ({ n: 'Cursor', ok: true, bars: [] }),
    },
    {
      name: 'Grok',
      fetch: async () => ({
        n: 'Grok',
        ok: true,
        bars: [{ l: 'Credits', p: 42, r: 0 }],
      }),
    },
  ];

  const windows = await collectWindows(providers);
  assert.deepStrictEqual(windows, [
    {
      n: 'Claude',
      ok: true,
      bars: [{ l: '5h', p: 10, r: 0 }],
    },
    { n: 'Codex', ok: false, bars: [], e: 'err' },
    { n: 'Cursor', ok: true, bars: [] },
    {
      n: 'Grok',
      ok: true,
      bars: [{ l: 'Credits', p: 42, r: 0 }],
    },
  ]);

  console.log('push: provider rejection isolation passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd mac
bun push.test.js
```

Expected result: fail because `collectWindows` is not exported yet.

- [ ] **Step 3: Add the fixed registry and settled collection helper**

In `mac/push.js`, replace the four direct imports in `gather()` with this registry immediately after the provider imports:

```js
const PROVIDERS = [
  { name: 'Claude', fetch: fetchClaude },
  { name: 'Codex', fetch: fetchCodex },
  { name: 'Cursor', fetch: fetchCursor },
  { name: 'Grok', fetch: fetchGrok },
];
```

Add this helper before `gather()`:

```js
async function collectWindows(providers) {
  const results = await Promise.allSettled(
    providers.map((provider) => Promise.resolve().then(() => provider.fetch()))
  );
  return results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    return { n: providers[i].name, ok: false, bars: [], e: 'err' };
  });
}
```

Replace `gather()` with:

```js
async function gather() {
  const wins = await collectWindows(PROVIDERS);
  return buildFrame(wins, Date.now() / 1000);
}
```

Keep `summarize()`, serial handling, modes, and frame construction unchanged. Export the helper with the existing exports:

```js
module.exports = { gather, summarize, collectWindows };
```

- [ ] **Step 4: Include the new test in the package script**

In `mac/package.json`, append `&& bun push.test.js && bash ../pusher.test.sh` to the existing `test` script so it becomes:

```json
"test": "bun lib/jwt.test.js && bun lib/grpcweb.test.js && bun providers/claude.test.js && bun providers/codex.test.js && bun providers/cursor.test.js && bun providers/grok.test.js && bun frame.test.js && bun push.test.js && bash ../pusher.test.sh"
```

- [ ] **Step 5: Run the focused and full tests**

Run:

```bash
cd mac
bun push.test.js
bun run test
```

Expected result: the focused test prints `push: provider rejection isolation passed`, and the full command passes all existing tests plus the new collection test.

---

### Task 3: LaunchAgent, Firmware, and Documentation Cleanup

**Files:**
- Modify: `pusher.sh`
- Test: `pusher.test.sh`
- Modify: `firmware/src/main.cpp`
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- The generated LaunchAgent keeps its current label, working directory, logging, and KeepAlive behavior, adding only `CLAUDE_CONFIG_DIR` to its environment.
- Firmware state and rendering remain unchanged after removing the unused field.
- README and repository instructions document the same default and override users can pass to direct and background runs.

- [ ] **Step 1: Add the effective profile to the LaunchAgent plist**

First add this failing regression test as `pusher.test.sh`. It uses a temporary home and a no-op `launchctl`, so it never touches the real LaunchAgent:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_HOME="$(mktemp -d)"
trap 'rm -rf "$TEMP_HOME"' EXIT

mkdir -p "$TEMP_HOME/bin"
ln -s /usr/bin/true "$TEMP_HOME/bin/launchctl"

HOME="$TEMP_HOME/home" \
PATH="$TEMP_HOME/bin:$PATH" \
CLAUDE_CONFIG_DIR='/tmp/profile/a&b' \
"$ROOT/pusher.sh" start >/dev/null

PLIST="$TEMP_HOME/home/Library/LaunchAgents/com.jonaspauleta.m5usage.plist"
profile=$(/usr/bin/plutil -extract EnvironmentVariables.CLAUDE_CONFIG_DIR raw -o - "$PLIST")
if [[ "$profile" != '/tmp/profile/a&b' ]]; then
  printf 'unexpected Claude profile in plist: %s\n' "$profile" >&2
  exit 1
fi

printf 'pusher: profile plist value passed\n'
```

Run the failing test:

```bash
bash pusher.test.sh
```

Expected result: fail because the unescaped ampersand makes the generated plist invalid XML.

In `pusher.sh`, define the effective profile beside the existing path variables:

```bash
CLAUDE_CONFIG_DIR_VALUE="${CLAUDE_CONFIG_DIR:-$HOME/.claude-voltimum}"
```

Add this XML helper and escaped values before `write_plist()`:

```bash
xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "$value"
}

BUN_XML="$(xml_escape "$BUN")"
MACDIR_XML="$(xml_escape "$MACDIR")"
LOG_XML="$(xml_escape "$LOG")"
CLAUDE_CONFIG_DIR_XML="$(xml_escape "$CLAUDE_CONFIG_DIR_VALUE")"
```

Use the escaped values in every variable-derived plist element:

```bash
        <string>$BUN_XML</string>
    <key>WorkingDirectory</key>  <string>$MACDIR_XML</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>CLAUDE_CONFIG_DIR</key><string>$CLAUDE_CONFIG_DIR_XML</string>
    </dict>
    <key>RunAtLoad</key>         <true/>
    <key>KeepAlive</key>         <true/>
    <key>StandardOutPath</key>   <string>$LOG_XML</string>
    <key>StandardErrorPath</key> <string>$LOG_XML</string>
```

Do not change the LaunchAgent label, `ProgramArguments`, working directory, logging paths, `RunAtLoad`, or `KeepAlive` settings.

Run the regression test again:

```bash
bash pusher.test.sh
```

Expected result: `pusher: profile plist value passed`.

- [ ] **Step 2: Remove the unused firmware state**

In `firmware/src/main.cpp`, remove the `haveGood` member from `struct Win`:

```cpp
  bool haveGood;
```

Also remove this assignment from `handleLine()`:

```cpp
      d.haveGood = true;
```

Keep the existing `nbar` update and last-good bar retention logic. No rendering or serial behavior changes.

- [ ] **Step 3: Update README profile instructions and repair its ending**

Change the Claude prerequisite to explicitly identify the default profile:

```markdown
  - **Claude:** Claude Code logged in with the `~/.claude-voltimum` profile (or the profile selected by `CLAUDE_CONFIG_DIR`).
```

Add this option alongside `PORT`, `POLL_MS`, and the other runtime options:

```markdown
- `CLAUDE_CONFIG_DIR=/path/to/profile bun start` to select a different Claude Code profile.
- `CLAUDE_CONFIG_DIR=/path/to/profile ./pusher.sh start` to pass that profile to the LaunchAgent.
```

Replace the current Keychain paragraph with:

```markdown
The Claude provider reads the selected profile's `.credentials.json` first and
falls back to its macOS Keychain item when that file has no usable token. Cursor
still reads its token from the macOS Keychain. The first time `bun` reads a
Keychain item, macOS may pop a "confidential information" dialog. Click **Always
Allow** so the pusher keeps working unattended (e.g. after a reboot).
```

Remove the final unmatched line containing only `` ``` `` from the end of the file.

- [ ] **Step 4: Document the environment variable in repository instructions**

Update the `CLAUDE.md` environment-variable list from:

```markdown
`PORT` (pin serial port, else auto-detects `/dev/cu.usbserial*`), `POLL_MS`, `CODEX_HOME`, `GROK_HOME`.
```

to:

```markdown
`PORT` (pin serial port, else auto-detects `/dev/cu.usbserial*`), `POLL_MS`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME`.
```

Add a short sentence immediately after it:

```markdown
`CLAUDE_CONFIG_DIR` defaults to `~/.claude-voltimum`; it can select another Claude Code profile for direct runs or the LaunchAgent.
```

- [ ] **Step 5: Run syntax and documentation checks**

Run from the repository root:

```bash
bash -n pusher.sh
```

Then inspect the diff and confirm that only the intended current files changed, the historical July documents are untouched, and no credential values appear:

```bash
git diff --check
git diff -- README.md CLAUDE.md pusher.sh pusher.test.sh firmware/src/main.cpp mac/providers/claude.js mac/push.js mac/package.json mac/providers/claude.test.js mac/push.test.js
```

Expected result: Bash syntax passes, `git diff --check` emits no whitespace errors, and the diff contains only path/configuration, rejection-isolation, dead-field, test, and documentation changes.

---

### Task 4: Full Verification

**Files:**
- Verify: `mac/package.json`, all `mac/**/*.test.js`, `pusher.sh`, `pusher.test.sh`, `firmware/src/main.cpp`

- [ ] **Step 1: Run all Mac-side tests**

Run:

```bash
cd mac
bun run test
```

Expected result: every existing test, `push.test.js`, and `pusher.test.sh` pass. No test should call a live provider endpoint or print a token.

- [ ] **Step 2: Compile the firmware**

Run:

```bash
cd firmware
pio run
```

Expected result: the `m5stack-core` environment compiles successfully. If PlatformIO is unavailable, report that toolchain limitation instead of modifying the firmware further.

- [ ] **Step 3: Verify the runtime contract without printing secrets**

From `mac/`, run the existing replay mode only if a connected device is available:

```bash
bun push.js --replay
```

Stop it with an ordinary interrupt after confirming it starts. For the code-only gate, inspect that `gather()` still calls `buildFrame()` and that the provider registry has exactly four entries in Claude, Codex, Cursor, Grok order. Do not run live `--stdout` unless explicitly needed, because it reads real credentials and contacts provider endpoints.

- [ ] **Step 4: Review final worktree state**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected result: only the approved implementation files and the four new test/spec/plan files are present, with no generated firmware artifacts or credential files added. Do not commit unless the user explicitly requests it.
