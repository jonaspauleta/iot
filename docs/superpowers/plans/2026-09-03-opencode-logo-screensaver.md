# OpenCode Screensaver and Provider Marks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invented provider glyphs and 7x7 idle artwork with first-party-derived LCD marks, and expose Cursor's first-party, third-party, and Grok Bot usage bars.

**Architecture:** The Mac keeps ownership of credentials and HTTP. `mac/providers/cursor.js` will parse the core and optional Bot responses separately, then return exactly three normalized bars. Firmware will keep the existing renderer and state machine, use a small `brand_marks.h` header for 16x16 monochrome masks, and draw the official OpenCode silhouette from rectangles for the option-A saver.

**Tech Stack:** Bun 1.3+ with built-in `fetch` and CommonJS modules; Arduino C++ on an ESP32 M5Stack Core; PlatformIO; M5Unified/M5GFX; ArduinoJson.

## Global Constraints

- Board is `m5stack-core-esp32` with a 320x240 LCD in landscape rotation.
- Runtime serial speed is 115200 baud.
- Upload speed stays exactly 460800 baud.
- `SAVER_MS` stays exactly 30000 ms.
- The saver render tick stays approximately 66 ms, or 15 fps.
- Usage rendering stays approximately 1 Hz.
- No new runtime dependencies or network access from the firmware.
- No changes to the serial protocol or top-level frame schema.
- No source ZIPs or large bitmap assets committed to the repository.
- Small 1-bit compile-time masks derived from the first-party SVGs are allowed.
- No provider credentials are printed, logged, or written except Codex's existing atomic auth refresh behavior.
- Keep the waking button press consumed. Do not alter paging or `REFRESH` behavior.
- Do not run a serial monitor while the pusher agent owns the port.
- Preserve unrelated worktree changes. The existing plan file is stale and is replaced by this plan.

## File Map

- Create `firmware/src/brand_marks.h`: four 16x16 source-derived masks, the `BrandMask` type, and a templated pixel-mask renderer.
- Modify `firmware/src/main.cpp`: include the masks, enlarge the label buffer, map provider names to marks, render the header marks, and replace the saver geometry.
- Modify `mac/providers/cursor.js`: add the pure Bot parser, injectable optional-request helper, new labels, and core/Bot bar composition.
- Modify `mac/providers/cursor.test.js`: cover exact labels, core fallbacks, Bot parsing, request headers, and optional failure isolation.
- Create `mac/fixtures/cursor-bot.json`: valid optional Bot response fixture.
- Modify `mac/push.js`: update replay frames to use the production Cursor labels.
- Do not modify `mac/frame.js`, `firmware/platformio.ini`, the serial frame shape, or authentication storage.

---

### Task 1: Define Cursor's Three Pure Bars

**Files:**
- Modify: `mac/providers/cursor.test.js`
- Create: `mac/fixtures/cursor-bot.json`
- Modify: `mac/providers/cursor.js`

**Interfaces:**
- Consumes: existing `parseCursor(json)`, `isNum()`, and `toUnixSeconds()`.
- Produces: `parseCursor(json) -> { ok: true, bars: Bar[] } | { ok: false, e: 'err' }`, returning exactly three bars; `parseCursorBot(json) -> { p: number, r: number }`.

- [ ] **Step 1: Add the valid Bot fixture**

Create `mac/fixtures/cursor-bot.json` with a numeric percentage and ISO reset:

```json
{
  "usagePercent": 82.5,
  "nextResetTimestampUtc": "2025-08-02T12:30:00Z"
}
```

- [ ] **Step 2: Rewrite the pure parser assertions before changing implementation**

In `mac/providers/cursor.test.js`, import the new parser and fixture, then make the modern case assert the exact production labels and an unknown third bar. Replace the existing modern assertions with:

```js
const { parseCursor, parseCursorBot } = require('./cursor');
const botFixture = require(path.join(__dirname, '..', 'fixtures', 'cursor-bot.json'));

const expectedReset = 1754006400;

{
  const parsed = parseCursor(modernFixture);
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(parsed.bars, [
    { l: '1st party models', p: 60.1, r: expectedReset },
    { l: '3rd party models', p: 13.4, r: expectedReset },
    { l: 'grok bot', p: -1, r: 0 },
  ]);
}

{
  const bot = parseCursorBot(botFixture);
  assert.deepStrictEqual(bot, { p: 82.5, r: 1754137800 });
}

{
  assert.deepStrictEqual(parseCursorBot({}), { p: -1, r: 0 });
  assert.deepStrictEqual(parseCursorBot({ usagePercent: '82.5' }), { p: -1, r: 0 });
}
```

Keep the legacy case, but change its labels and expectations to:

```js
{
  const parsed = parseCursor(legacyFixture);
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(parsed.bars, [
    { l: '1st party models', p: -1, r: expectedReset },
    { l: '3rd party models', p: -1, r: expectedReset },
    { l: 'grok bot', p: -1, r: 0 },
  ]);
}
```

- [ ] **Step 3: Run the focused test and confirm it fails for the old contract**

Run from `mac/`:

```bash
bun providers/cursor.test.js
```

Expected: FAIL because the current implementation still returns `Total`, `Auto`, and `API`, and does not export `parseCursorBot`.

- [ ] **Step 4: Replace `parseCursor()` with the three-bar core parser**

In `mac/providers/cursor.js`, remove the `overall` and `teamPooled` total-percentage fallback logic and use this implementation:

```js
// PURE: response JSON in, bars out. No I/O.
function parseCursor(json) {
  if (!json || (!json.individualUsage && !json.teamUsage)) {
    return { ok: false, e: 'err' };
  }

  const iu = json.individualUsage || {};
  const plan = iu.plan || {};
  const reset = toUnixSeconds(json.billingCycleEnd);

  return {
    ok: true,
    bars: [
      {
        l: '1st party models',
        p: isNum(plan.autoPercentUsed) ? plan.autoPercentUsed : -1,
        r: reset,
      },
      {
        l: '3rd party models',
        p: isNum(plan.apiPercentUsed) ? plan.apiPercentUsed : -1,
        r: reset,
      },
      { l: 'grok bot', p: -1, r: 0 },
    ],
  };
}

// PURE: optional Cursor Bot response in, one bar value out. No I/O.
function parseCursorBot(json) {
  if (!json || !isNum(json.usagePercent)) return { p: -1, r: 0 };
  return {
    p: json.usagePercent,
    r: toUnixSeconds(json.nextResetTimestampUtc),
  };
}
```

Do not change `isNum()`, `toUnixSeconds()`, token validation, or the exported `fetchCursor()` name.

- [ ] **Step 5: Run the focused test and confirm the pure parsers pass**

Run:

```bash
bun providers/cursor.test.js
```

Expected: `PASS providers/cursor.test.js`.

- [ ] **Step 6: Commit the pure Cursor contract**

Run:

```bash
git add mac/providers/cursor.js mac/providers/cursor.test.js mac/fixtures/cursor-bot.json
git commit -m "feat: rename cursor usage source bars"
```

Expected: one commit containing only the pure parser, its test, and the fixture.

---

### Task 2: Isolate the Optional Cursor Bot Request

**Files:**
- Modify: `mac/providers/cursor.js`
- Modify: `mac/providers/cursor.test.js`
- Modify: `mac/push.js`

**Interfaces:**
- Consumes: `parseCursor(json)`, `parseCursorBot(json)`, and the existing WorkOS cookie.
- Produces: `fetchCursorBot(cookie, request = fetch) -> Promise<{ p: number, r: number }>` and a `fetchCursor()` result with the three production labels.

- [ ] **Step 1: Add injectable request tests before changing the network code**

Append these asynchronous assertions to `mac/providers/cursor.test.js`, importing `fetchCursorBot` alongside the pure parsers:

```js
(async () => {
  const calls = [];
  const valid = await fetchCursorBot('test-cookie', async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => botFixture };
  });

  assert.deepStrictEqual(valid, { p: 82.5, r: 1754137800 });
  assert.strictEqual(calls[0].url, 'https://cursor.com/api/dashboard/get-sand-usage-status');
  assert.strictEqual(calls[0].init.method, 'POST');
  assert.strictEqual(calls[0].init.headers.Cookie, 'test-cookie');
  assert.strictEqual(calls[0].init.headers.Accept, 'application/json');

  const httpFailure = await fetchCursorBot('test-cookie', async () => ({ ok: false, status: 503 }));
  assert.deepStrictEqual(httpFailure, { p: -1, r: 0 });

  const networkFailure = await fetchCursorBot('test-cookie', async () => {
    throw new Error('offline');
  });
  assert.deepStrictEqual(networkFailure, { p: -1, r: 0 });

  console.log('PASS providers/cursor.test.js');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Move the existing synchronous test blocks and their `console.log` into the async function before these assertions, leaving one final success log.

- [ ] **Step 2: Run the focused test and confirm the request helper is missing**

Run:

```bash
bun providers/cursor.test.js
```

Expected: FAIL with `fetchCursorBot` undefined.

- [ ] **Step 3: Implement the optional request helper**

Add this function after `parseCursorBot()` in `mac/providers/cursor.js`:

```js
async function fetchCursorBot(cookie, request = fetch) {
  try {
    const res = await request('https://cursor.com/api/dashboard/get-sand-usage-status', {
      method: 'POST',
      headers: { Cookie: cookie, Accept: 'application/json' },
    });
    if (!res.ok) return { p: -1, r: 0 };
    return parseCursorBot(await res.json());
  } catch {
    return { p: -1, r: 0 };
  }
}
```

The helper must not log the cookie or response body. A 401, 403, non-OK response, JSON error, or malformed body returns only the unknown Bot value.

- [ ] **Step 4: Compose the optional value in `fetchCursor()`**

After the existing core response has passed `parseCursor()`, replace the current direct return with:

```js
    const bot = await fetchCursorBot(cookie);
    return {
      n: 'Cursor',
      ok: true,
      bars: [parsed.bars[0], parsed.bars[1], {
        l: 'grok bot',
        p: bot.p,
        r: bot.r,
      }],
    };
```

Keep the existing returns for missing credentials, invalid JWTs, expired tokens, core 401/403, other core HTTP failures, and core parse failures. Only the optional request is isolated.

Export the new pure/request helpers with the existing API:

```js
module.exports = { parseCursor, parseCursorBot, fetchCursorBot, fetchCursor };
```

- [ ] **Step 5: Update replay data to use production labels**

In `mac/push.js`, replace both Cursor replay bar arrays with these exact shapes:

```js
{ n: 'Cursor', ok: 1, b: [
  { l: '1st party models', p: 66, r: now + 20 * D },
  { l: '3rd party models', p: 9, r: now + 20 * D },
  { l: 'grok bot', p: 73, r: now + 20 * D },
] }
```

```js
{ n: 'Cursor', ok: 1, b: [
  { l: '1st party models', p: 40, r: now + 10 * D },
  { l: '3rd party models', p: -1, r: 0 },
  { l: 'grok bot', p: -1, r: 0 },
] }
```

Do not change the replay provider order or timing.

- [ ] **Step 6: Run the focused and full Mac tests**

Run from `mac/`:

```bash
bun providers/cursor.test.js
bun run test
```

Expected: both commands pass. The full command must continue to cover Claude, Codex, Grok, frame normalization, provider rejection isolation, and `pusher.test.sh`.

- [ ] **Step 7: Commit the optional Cursor request**

Run:

```bash
git add mac/providers/cursor.js mac/providers/cursor.test.js mac/push.js
git commit -m "feat: add cursor bot usage source"
```

Expected: one commit containing the optional request, its injected-request tests, and replay labels.

---

### Task 3: Add Source-Derived Firmware Masks

**Files:**
- Create: `firmware/src/brand_marks.h`

**Interfaces:**
- Consumes: `drawPixel(x, y, color)` on both `M5Canvas` and `M5.Display`.
- Produces: `BrandMask`, `drawBrandMask(G&, const BrandMask&, int, int, uint16_t)`, and four `static const BrandMask` values named `BRAND_CLAUDE`, `BRAND_CODEX`, `BRAND_CURSOR`, and `BRAND_GROK`.

- [ ] **Step 1: Create the compile-time mask header**

Create `firmware/src/brand_marks.h` with the following complete contents. Each row uses bit `0` for the leftmost pixel. The rows are 16x16 alpha-threshold rasterizations of the first-party SVG references named in the approved spec.

```cpp
#ifndef BRAND_MARKS_H
#define BRAND_MARKS_H

#include <stdint.h>

struct BrandMask {
  const uint16_t* rows;
  uint8_t width;
  uint8_t height;
};

template <typename G>
void drawBrandMask(G& g, const BrandMask& mark, int x, int y, uint16_t color) {
  for (uint8_t row = 0; row < mark.height; row++) {
    for (uint8_t col = 0; col < mark.width; col++) {
      if (mark.rows[row] & (uint16_t(1) << col)) {
        g.drawPixel(x + col, y + row, color);
      }
    }
  }
}

static const uint16_t CLAUDE_ROWS[16] = {
  0x0230, 0x0330, 0x3330, 0x3b66,
  0x1f7e, 0x0ff8, 0xcff0, 0x7fef,
  0x0fff, 0xffe0, 0x0ff8, 0x1f6c,
  0x3da0, 0x0db0, 0x1990, 0x0080,
};

static const uint16_t CODEX_ROWS[16] = {
  0x01c0, 0x0fb0, 0x3f18, 0x20dc,
  0x4e6e, 0x79ab, 0x776b, 0x4c2b,
  0xd032, 0xd2ee, 0x519e, 0x7272,
  0x3b84, 0x18fc, 0x0ff0, 0x0380,
};

static const uint16_t CURSOR_ROWS[16] = {
  0x0380, 0x07e0, 0x1ff8, 0x7ffc,
  0x4006, 0x600e, 0x603e, 0x70fe,
  0x70fe, 0x78fe, 0x78fe, 0x7cfe,
  0x3efe, 0x1ef8, 0x07e0, 0x01c0,
};

static const uint16_t GROK_ROWS[16] = {
  0x0000, 0x4000, 0x6fe0, 0x37f0,
  0x3838, 0x3c18, 0x360c, 0x330c,
  0x300c, 0x300c, 0x3818, 0x1c18,
  0x0fe4, 0x03c2, 0x0000, 0x0000,
};

static const BrandMask BRAND_CLAUDE = { CLAUDE_ROWS, 16, 16 };
static const BrandMask BRAND_CODEX = { CODEX_ROWS, 16, 16 };
static const BrandMask BRAND_CURSOR = { CURSOR_ROWS, 16, 16 };
static const BrandMask BRAND_GROK = { GROK_ROWS, 16, 16 };

#endif
```

- [ ] **Step 2: Check the header for ASCII and whitespace errors**

Run from the repository root:

```bash
git add firmware/src/brand_marks.h
git diff --cached --check -- firmware/src/brand_marks.h
```

Expected: no output. Do not add the original ZIPs, SVG files, or PNG files to the repository.

- [ ] **Step 3: Commit the isolated mask asset**

Run:

```bash
git add firmware/src/brand_marks.h
git commit -m "feat: add source-derived provider masks"
```

Expected: one commit containing only `firmware/src/brand_marks.h`.

---

### Task 4: Integrate the Marks and Official OpenCode Saver

**Files:**
- Modify: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: `BrandMask`, `drawBrandMask()`, the existing `Win.n`, `C_BG`, provider colors, and the existing templated renderer paths.
- Produces: a 17-byte bar-label buffer, source-derived provider headers, and `drawOpenCodeMark(G&)` using option-A geometry.

- [ ] **Step 1: Establish the firmware baseline before editing**

Run from `firmware/`:

```bash
pio run
```

Expected: PlatformIO finishes with `SUCCESS` on the current firmware.

- [ ] **Step 2: Include the mask header and expand the label storage**

Add this include after the existing includes:

```cpp
#include "brand_marks.h"
```

Change the `Bar` definition from:

```cpp
struct Bar { int p; uint32_t r; char l[10]; };
```

to:

```cpp
struct Bar { int p; uint32_t r; char l[17]; };
```

Add these compile-time checks immediately after the definition:

```cpp
static_assert(sizeof("1st party models") <= sizeof(((Bar*)nullptr)->l), "Cursor label buffer too small");
static_assert(sizeof("3rd party models") <= sizeof(((Bar*)nullptr)->l), "Cursor label buffer too small");
```

- [ ] **Step 3: Replace `drawProviderMark()` with source-mask mapping**

Replace the current procedural helper with this complete implementation:

```cpp
template <typename G>
void drawProviderMark(G& g, const char* name, int x, int y) {
  const BrandMask* mark = nullptr;
  uint16_t color = C_DIM;

  if (strcmp(name, "Claude") == 0) {
    mark = &BRAND_CLAUDE;
    color = C_CLAUDE;
  } else if (strcmp(name, "Codex") == 0) {
    mark = &BRAND_CODEX;
    color = C_CODEX;
  } else if (strcmp(name, "Cursor") == 0) {
    mark = &BRAND_CURSOR;
    color = C_CURSOR;
  } else if (strcmp(name, "Grok") == 0) {
    mark = &BRAND_GROK;
    color = C_GROK;
  }

  if (mark) {
    drawBrandMask(g, *mark, x, y, color);
  } else {
    g.fillRoundRect(x + 4, y + 4, 8, 8, 2, C_DIM);
  }
}
```

Keep the existing provider color declarations and initialization, but set the OpenCode neutral color to the first-party light value:

```cpp
C_OPENCODE = M5.Display.color565(241, 236, 236);
```

Keep Claude coral, Codex mint, Cursor light neutral, and Grok blue as the device tint colors. The SVG geometry, not the tint, is the brand source of truth.

- [ ] **Step 4: Update the usage header spacing**

In `drawUI(G& g)`, replace the current mark/name lines with:

```cpp
  // Header: source-derived provider mark, provider name, degraded tag, heartbeat.
  g.setFont(&fonts::FreeSansBold12pt7b);
  g.setTextColor(C_TEXT);
  g.setTextDatum(TL_DATUM);
  drawProviderMark(g, w.n, BAR_X, 6);
  g.drawString(w.n, BAR_X + 21, 6);
```

Leave heartbeat, error/refresh tags, index dots, bar region, and button hint at their existing coordinates.

- [ ] **Step 5: Replace the 7x7 saver with the official option-A silhouette**

Replace the current `OPENCODE_GRID`, `OPENCODE_CELL`, `OPENCODE_GAP`, and `drawOpenCodeMark()` implementation with:

```cpp
// Screensaver: official OpenCode square mark with a restrained vertical float.
static const int OPENCODE_W = 96;
static const int OPENCODE_H = 120;

template <typename G>
void drawOpenCodeMark(G& g) {
  g.fillRect(0, 0, W, H, C_BG);

  int x = (W - OPENCODE_W) / 2;
  int y = (H - OPENCODE_H) / 2 + (int)(sinf(millis() * 0.0013f) * 3.0f);

  // Source geometry is a 240x300 outer form with a 120x180 opening, scaled 0.4x.
  g.fillRect(x, y, OPENCODE_W, OPENCODE_H, C_OPENCODE);
  g.fillRect(x + 24, y + 24, 48, 72, C_BG);
}
```

Do not add a header, page dots, status, button hint, wordmark, rotation, blink, pulse, or usage-reactive behavior to the saver. Keep the existing `render()` dispatch, sprite allocation, direct-draw fallback, saver threshold, and saver tick unchanged.

- [ ] **Step 6: Compile the integrated firmware**

Run:

```bash
pio run
```

Expected: `SUCCESS` with no unresolved `BrandMask`, `drawBrandMask`, or `drawOpenCodeMark` symbols.

- [ ] **Step 7: Commit the firmware integration**

Run:

```bash
git add firmware/src/main.cpp
git commit -m "feat: render first-party provider marks"
```

Expected: one commit containing only `firmware/src/main.cpp`.

---

### Task 5: Run the Full Verification and Flash Safely

**Files:**
- None expected. This task verifies the committed code and, when hardware is connected, deploys it.

**Interfaces:**
- Consumes: the four implementation commits, `mac/package.json` test script, PlatformIO, `./pusher.sh`, and the existing USB serial port.
- Produces: passing software checks and observed device behavior. Physical observations are explicitly unverified if the board is unavailable.

- [ ] **Step 1: Inspect final git state and whitespace**

Run from the repository root:

```bash
git status --short --branch
git diff --check HEAD~4..HEAD
```

Expected: only intentional implementation commits are present, and `git diff --check` prints no output. Do not stage the visual companion or unrelated files.

- [ ] **Step 2: Run the complete Mac test suite**

Run:

```bash
cd mac && bun run test
```

Expected: all provider, parser, frame, collection, and pusher tests pass. No test may print a token or session cookie.

- [ ] **Step 3: Run the final firmware build**

Run:

```bash
cd firmware && pio run
```

Expected: PlatformIO reports `SUCCESS`.

- [ ] **Step 4: Stop the LaunchAgent before uploading**

Run from the repository root:

```bash
./pusher.sh stop
```

Expected: the pusher releases the USB serial port. Do not start a serial monitor.

- [ ] **Step 5: Flash without changing the upload speed**

Run:

```bash
cd firmware && pio run -t upload
```

Expected: upload completes with `SUCCESS` at the existing 460800 baud setting. Do not change `firmware/platformio.ini`.

- [ ] **Step 6: Restart the pusher and confirm port ownership**

Run from the repository root:

```bash
./pusher.sh start
./pusher.sh status
```

Expected: the LaunchAgent is loaded, the pusher owns the serial port, and the device receives a frame. Do not run `bun start` alongside the LaunchAgent.

- [ ] **Step 7: Verify the usage pages on hardware**

Use buttons A and C to page through the four windows and verify:

- Claude shows the coral Claude Code Spark silhouette before `Claude`.
- Codex shows the mint OpenAI Blossom silhouette before `Codex`.
- Cursor shows the light official cube before `Cursor`.
- Grok shows the blue official xAI logomark before `Grok`.
- Cursor labels read `1st party models`, `3rd party models`, and `grok bot` without truncation.
- A missing Bot value renders `--` and does not dim or invalidate the two core bars.
- Existing percentages, reset strings, index dots, heartbeat, degraded tags, and button hint remain readable.

- [ ] **Step 8: Verify the option-A saver and state machine**

Leave the device untouched for 30 seconds and verify:

- The screen is cleared to the dark background.
- The official OpenCode mark is centered at roughly 96x120 pixels.
- The mark floats vertically by no more than 3 pixels and leaves no trail or flicker.
- No provider name, header, page dots, status, button hint, or other text appears.
- Pressing A, B, or C wakes the usage page and consumes the waking press.
- A serial frame received while the saver is active does not wake it.
- After wake, A/C paging and B refresh behave as before.
- Degraded and stale provider pages keep their marks and existing fallback behavior.

If hardware is unavailable, report the Mac test and firmware build results, and state that all physical observations remain unverified.

## Self-Review Checklist

- Spec coverage: Task 1 covers exact Cursor labels and pure parser behavior; Task 2 covers optional Bot request isolation, fallback, headers, and replay; Task 3 covers first-party masks; Task 4 covers label storage, header layout, OpenCode geometry, and preserved state behavior; Task 5 covers software, port safety, flashing, and hardware checks.
- File boundaries: network/parser work stays in `mac/providers/cursor.js`; mask data stays in `firmware/src/brand_marks.h`; layout and state stay in `firmware/src/main.cpp`.
- Type consistency: `BrandMask`, `drawBrandMask(G&, const BrandMask&, int, int, uint16_t)`, `parseCursorBot(json)`, and `fetchCursorBot(cookie, request = fetch)` are used consistently in every task.
- Protocol consistency: Cursor labels change only inside the existing `b[].l` strings; the frame version and `{ n, ok, b }` shape do not change.
- Error consistency: core Cursor errors retain `reauth` and `err`; optional Bot errors return only `{ p: -1, r: 0 }`.
- Timing consistency: `SAVER_MS`, 66 ms saver tick, 1000 ms usage tick, button consumption, and serial parsing remain unchanged.
- Placeholder scan: no `TBD`, `TODO`, `FIXME`, or unspecified implementation step appears in this plan.
