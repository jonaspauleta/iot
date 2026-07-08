# M5Stack Claude Code Usage Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live Claude Code plan usage (session / week / Fable bars) on an M5Stack Core, driven from the Mac over USB serial.

**Architecture:** A Mac Node process runs `claude -p "/usage"` on a timer, parses the three plan-limit lines with a pure parser module, and writes one compact JSON line per poll to the M5Stack over USB serial (115200). The firmware (Arduino / M5Unified) reads newline-delimited JSON and renders three color-coded progress bars to a flicker-free sprite. The device is a pure display; all logic lives on the Mac.

**Tech Stack:** Node 18+ with `serialport`; PlatformIO with `M5Unified` + `ArduinoJson`; ESP32 (m5stack-core-esp32).

## Global Constraints

- No em dashes anywhere (prose, code, comments, commits). Use commas, periods, or parentheses.
- Board: `m5stack-core-esp32`, LCD 320x240, landscape (rotation 1).
- Serial: 115200 baud, newline-delimited JSON, one frame per line.
- Data source: `claude -p "/usage"` run with `cwd` = a trusted directory and `stdin` = `/dev/null`.
- Serial contract (exact keys): `{"s":{"p":<int>,"r":<str>},"w":{...},"f":{...},"ok":1}`; failure frames are `{"ok":0}` with no `s`/`w`/`f`.
- push.js opens the serial port once and holds it open; never toggle DTR/RTS.
- Bar color thresholds: `pct < 60` green, `60 <= pct < 85` amber, `pct >= 85` red.
- All file paths are under `/Users/jonaspauleta/Code/iot`.

## File Structure

```
iot/
  firmware/
    platformio.ini        # ESP32 build config, libs, baud
    src/main.cpp          # serial read + JSON parse + sprite render
  mac/
    usage-parser.js       # pure parse(text) -> structured usage (no I/O)
    usage-parser.test.js  # assert-based self-check for the parser
    push.js               # loop: run CLI, parse, frame, write serial
    push.test.js          # assert-based self-check for toFrame
    package.json          # serialport dep + scripts
    fixtures/usage.txt     # captured /usage output for the parser test
  README.md               # flash + run + troubleshooting
```

Dependency order: Task 1 (parser) -> Task 2 (push, consumes parser) -> Task 3 (firmware, consumes only the serial contract) -> Task 4 (README + end-to-end bring-up).

---

### Task 1: Usage parser (pure logic, TDD)

**Files:**
- Create: `mac/fixtures/usage.txt`
- Create: `mac/usage-parser.js`
- Test: `mac/usage-parser.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parse(text: string) -> { ok: false } | { ok: true, session: Bar, week: Bar, fable: Bar }` where `Bar = { pct: number, reset: string }`.
  - `cleanReset(s: string) -> string`.
  - Exported via `module.exports = { parse, cleanReset }` (CommonJS).

- [ ] **Step 1: Create the fixture from real `/usage` output**

Create `mac/fixtures/usage.txt`:

```
You are currently using your subscription to power your Claude Code usage

Current session: 5% used · resets Jul 8 at 6:19pm (Europe/Lisbon)
Current week (all models): 59% used · resets Jul 10 at 3am (Europe/Lisbon)
Current week (Fable): 82% used · resets Jul 10 at 3am (Europe/Lisbon)

What's contributing to your limits usage?
Approximate, based on local sessions on this machine.

Last 24h · 6853 requests · 18 sessions
  97% of your usage came from subagent-heavy sessions
```

Note: the separator before `resets` is the middot character U+00B7 (`·`). Preserve it exactly.

- [ ] **Step 2: Write the failing test**

Create `mac/usage-parser.test.js`:

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /Users/jonaspauleta/Code/iot/mac && node usage-parser.test.js`
Expected: FAIL with `Cannot find module './usage-parser'`.

- [ ] **Step 4: Write the parser**

Create `mac/usage-parser.js`:

```js
// Pure parser for `claude -p "/usage"` output. No I/O.

const RE = {
  session: /Current session:\s*(\d+)%\s*used\b.*?\bresets\s+(.+)/i,
  week: /Current week \(all models\):\s*(\d+)%\s*used\b.*?\bresets\s+(.+)/i,
  fable: /Current week \(Fable\):\s*(\d+)%\s*used\b.*?\bresets\s+(.+)/i,
};

function cleanReset(s) {
  return s
    .replace(/\s*\([^)]*\)\s*$/, '') // drop trailing " (Timezone)"
    .replace(/\bat\b/i, ' ') // drop the word "at"
    .replace(/\s+/g, ' ')
    .trim();
}

function one(text, re) {
  const m = text.match(re);
  if (!m) return null;
  return { pct: parseInt(m[1], 10), reset: cleanReset(m[2]) };
}

function parse(text) {
  const session = one(text, RE.session);
  const week = one(text, RE.week);
  const fable = one(text, RE.fable);
  if (!session || !week || !fable) return { ok: false };
  return { ok: true, session, week, fable };
}

module.exports = { parse, cleanReset };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/jonaspauleta/Code/iot/mac && node usage-parser.test.js`
Expected: PASS, prints `usage-parser: all assertions passed`.

- [ ] **Step 6: Commit**

```bash
cd /Users/jonaspauleta/Code/iot
git add mac/usage-parser.js mac/usage-parser.test.js mac/fixtures/usage.txt
git commit -m "feat: usage parser for claude -p /usage output"
```

---

### Task 2: Mac pusher (CLI -> serial loop)

**Files:**
- Create: `mac/package.json`
- Create: `mac/push.js`
- Test: `mac/push.test.js`

**Interfaces:**
- Consumes: `parse` from `./usage-parser`.
- Produces:
  - `toFrame(parsed) -> frame` mapping parser output to the short-key serial contract: `{ ok: 0 }` when `parsed.ok` is false, else `{ s:{p,r}, w:{p,r}, f:{p,r}, ok:1 }`.
  - Exported via `module.exports = { toFrame }`. The runtime loop runs only under `require.main === module`.
- Env: `PORT` (serial path, default: first `usbserial` port), `POLL_MS` (default 90000), `CLAUDE_CWD` (default: home dir).
- CLI flags: `--stdout` (print one frame, exit), `--replay` (stream synthetic frames).

- [ ] **Step 1: Create package.json**

Create `mac/package.json`:

```json
{
  "name": "m5-claude-usage",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "start": "node push.js",
    "stdout": "node push.js --stdout",
    "replay": "node push.js --replay",
    "test": "node usage-parser.test.js && node push.test.js"
  },
  "dependencies": {
    "serialport": "^12"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd /Users/jonaspauleta/Code/iot/mac && npm install`
Expected: installs `serialport`, creates `node_modules/` and `package-lock.json` with no errors.

- [ ] **Step 3: Write the failing test for toFrame**

Create `mac/push.test.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd /Users/jonaspauleta/Code/iot/mac && node push.test.js`
Expected: FAIL with `Cannot find module './push'`.

- [ ] **Step 5: Write push.js**

Create `mac/push.js`:

```js
#!/usr/bin/env node
// Poll `claude -p "/usage"`, parse, and push one JSON frame per poll to the
// M5Stack over USB serial. The device is a pure display.

const os = require('node:os');
const { execFile } = require('node:child_process');
const { SerialPort } = require('serialport');
const { parse } = require('./usage-parser');

const POLL_MS = Number(process.env.POLL_MS || 90000);
const CLAUDE_CWD = process.env.CLAUDE_CWD || os.homedir();
const PORT_PATH = process.env.PORT || null;
const MODE = process.argv[2] || '';

function toFrame(p) {
  if (!p.ok) return { ok: 0 };
  return {
    s: { p: p.session.pct, r: p.session.reset },
    w: { p: p.week.pct, r: p.week.reset },
    f: { p: p.fable.pct, r: p.fable.reset },
    ok: 1,
  };
}

function getUsage() {
  return new Promise((resolve) => {
    execFile(
      'claude',
      ['-p', '/usage'],
      { cwd: CLAUDE_CWD, timeout: 20000, maxBuffer: 1 << 20 },
      (err, stdout) => resolve(err ? { ok: false } : parse(stdout))
    );
  });
}

async function findPort() {
  if (PORT_PATH) return PORT_PATH;
  const ports = await SerialPort.list();
  const m = ports.find(
    (p) => /usbserial/i.test(p.path) || /usbserial/i.test(p.pnpId || '')
  );
  return m ? m.path : null;
}

// Open the port once and hold it open. Reopening every poll would reset the
// ESP32 every poll, so we keep a single handle and reconnect only on error.
let port = null;
let opening = false;

async function ensurePort() {
  if (port && port.isOpen) return port;
  if (opening) return null;
  opening = true;
  try {
    const path = await findPort();
    if (!path) {
      console.error('no usbserial port found');
      return null;
    }
    port = new SerialPort({ path, baudRate: 115200, autoOpen: false });
    await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res())));
    port.on('error', (e) => {
      console.error('serial error:', e.message);
      try { port.close(); } catch {}
      port = null;
    });
    port.on('close', () => { port = null; });
    console.error('serial open:', path);
    // The open above resets the ESP32 once; give it time to boot before writing.
    await new Promise((r) => setTimeout(r, 2500));
    return port;
  } catch (e) {
    console.error('open failed:', e.message);
    port = null;
    return null;
  } finally {
    opening = false;
  }
}

function writeFrame(frame) {
  if (!port || !port.isOpen) return;
  port.write(JSON.stringify(frame) + '\n', (err) => {
    if (err) console.error('write error:', err.message);
  });
}

async function tick() {
  const frame = toFrame(await getUsage());
  if (MODE === '--stdout') {
    console.log(JSON.stringify(frame));
    return;
  }
  await ensurePort();
  writeFrame(frame);
  console.error(
    new Date().toISOString(),
    frame.ok ? `s${frame.s.p} w${frame.w.p} f${frame.f.p}` : 'ok:0'
  );
}

async function replay() {
  const frames = [
    { s: { p: 0, r: '6:19pm' }, w: { p: 12, r: 'Jul 10 3am' }, f: { p: 5, r: 'Jul 10 3am' }, ok: 1 },
    { s: { p: 5, r: '6:19pm' }, w: { p: 59, r: 'Jul 10 3am' }, f: { p: 82, r: 'Jul 10 3am' }, ok: 1 },
    { s: { p: 97, r: '6:19pm' }, w: { p: 88, r: 'Jul 10 3am' }, f: { p: 100, r: 'Jul 10 3am' }, ok: 1 },
    { ok: 0 },
  ];
  await ensurePort();
  let i = 0;
  setInterval(() => {
    const f = frames[i % frames.length];
    console.error('replay', JSON.stringify(f));
    writeFrame(f);
    i++;
  }, 3000);
}

async function main() {
  if (MODE === '--replay') return replay();
  if (MODE === '--stdout') {
    await tick();
    process.exit(0);
  }
  await tick(); // immediate first frame
  setInterval(tick, POLL_MS);
}

if (require.main === module) main();

module.exports = { toFrame };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /Users/jonaspauleta/Code/iot/mac && node push.test.js`
Expected: PASS, prints `push: all assertions passed`.

- [ ] **Step 7: Verify end-to-end extraction against the real CLI**

Run: `cd /Users/jonaspauleta/Code/iot/mac && node push.js --stdout`
Expected: one JSON line like `{"s":{"p":5,"r":"Jul 8 6:19pm"},"w":{"p":59,"r":"Jul 10 3am"},"f":{"p":82,"r":"Jul 10 3am"},"ok":1}`. If it prints `{"ok":0}`, the `/usage` wording changed; update the regexes in `usage-parser.js`.

- [ ] **Step 8: Commit**

```bash
cd /Users/jonaspauleta/Code/iot
git add mac/package.json mac/package-lock.json mac/push.js mac/push.test.js
git commit -m "feat: mac pusher that streams usage frames over serial"
```

---

### Task 3: Firmware (serial -> sprite render)

**Files:**
- Create: `firmware/platformio.ini`
- Create: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: the serial contract from the Global Constraints: newline-delimited `{"s":{"p","r"},"w":{...},"f":{...},"ok":1}` or `{"ok":0}` at 115200 baud.
- Produces: on-device rendering only. No outputs consumed by other tasks.

- [ ] **Step 1: Ensure PlatformIO is installed**

Run: `pio --version`
Expected: prints a version. If "command not found", install with `brew install platformio` (or `pip install platformio`) and re-run.

- [ ] **Step 2: Create platformio.ini**

Create `firmware/platformio.ini`:

```ini
[env:m5stack-core]
platform = espressif32
board = m5stack-core-esp32
framework = arduino
monitor_speed = 115200
upload_speed = 921600
build_flags = -DCORE_DEBUG_LEVEL=0
lib_deps =
    m5stack/M5Unified@^0.2.7
    bblanchon/ArduinoJson@^7
; If PlatformIO cannot auto-pick the port, uncomment and set explicitly:
; upload_port = /dev/cu.usbserial-56750019571
; monitor_port = /dev/cu.usbserial-56750019571
```

- [ ] **Step 3: Write main.cpp**

Create `firmware/src/main.cpp`:

```cpp
#include <M5Unified.h>
#include <ArduinoJson.h>

// ---- layout (320x240 landscape) ----
static const int W = 320, H = 240;
static const int BAR_X = 12, BAR_W = 296, BAR_H = 16;
static const int BLOCK_Y0 = 34, BLOCK_H = 66;
static const uint32_t STALE_MS = 240000; // 4 min; > default 90s poll

// ---- colors (RGB565, set in setup) ----
uint16_t C_BG, C_TRACK, C_GREEN, C_AMBER, C_RED, C_TEXT, C_DIM;

M5Canvas canvas(&M5.Display);

struct Bar { int pct; String reset; };
struct State {
  Bar s{0, ""}, w{0, ""}, f{0, ""};
  bool haveData = false;
  bool lastOk = true;
  uint32_t lastRx = 0;
  bool beat = false;
} st;

String lineBuf;
uint32_t lastRender = 0;

uint16_t barColor(int pct) {
  if (pct >= 85) return C_RED;
  if (pct >= 60) return C_AMBER;
  return C_GREEN;
}

void drawBlock(int idx, const char* label, const Bar& b, bool stale) {
  int y = BLOCK_Y0 + idx * BLOCK_H;
  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextColor(stale ? C_DIM : C_TEXT);
  canvas.setTextDatum(TL_DATUM);
  canvas.drawString(label, BAR_X, y);
  char pctStr[8];
  snprintf(pctStr, sizeof(pctStr), "%d%%", b.pct);
  canvas.setTextDatum(TR_DATUM);
  canvas.drawString(pctStr, BAR_X + BAR_W, y);

  int by = y + 20;
  canvas.fillRoundRect(BAR_X, by, BAR_W, BAR_H, 4, C_TRACK);
  int p = b.pct < 0 ? 0 : (b.pct > 100 ? 100 : b.pct);
  int fw = (int)((long)BAR_W * p / 100);
  if (fw > 0) canvas.fillRoundRect(BAR_X, by, fw, BAR_H, 4, stale ? C_DIM : barColor(b.pct));

  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(C_DIM);
  canvas.setTextDatum(TL_DATUM);
  String rl = "resets ";
  rl += b.reset;
  canvas.drawString(rl, BAR_X, by + BAR_H + 4);
}

void render() {
  bool stale = st.haveData && (millis() - st.lastRx > STALE_MS);
  canvas.fillSprite(C_BG);

  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextColor(C_TEXT);
  canvas.setTextDatum(TL_DATUM);
  canvas.drawString("CLAUDE CODE", BAR_X, 10);

  canvas.fillCircle(W - 16, 16, 4, st.beat ? C_GREEN : C_TRACK);
  if (!st.lastOk) {
    canvas.setTextColor(C_AMBER);
    canvas.setTextDatum(TR_DATUM);
    canvas.drawString("!", W - 28, 8);
  }
  if (stale) {
    canvas.setFont(&fonts::FreeSans9pt7b);
    canvas.setTextColor(C_RED);
    canvas.setTextDatum(TR_DATUM);
    canvas.drawString("stale", W - 28, 10);
  }

  if (!st.haveData) {
    canvas.setFont(&fonts::FreeSans12pt7b);
    canvas.setTextColor(C_DIM);
    canvas.setTextDatum(MC_DATUM);
    canvas.drawString("Waiting for Mac...", W / 2, H / 2);
  } else {
    drawBlock(0, "SESSION - 5h", st.s, stale);
    drawBlock(1, "WEEK - all models", st.w, stale);
    drawBlock(2, "WEEK - Fable", st.f, stale);
  }
  canvas.pushSprite(0, 0);
}

void handleLine(const String& line) {
  JsonDocument doc;
  if (deserializeJson(doc, line)) return; // ignore non-JSON (boot chatter)
  if (!doc["ok"].is<int>()) return;
  st.lastRx = millis();
  st.beat = !st.beat;
  if (doc["ok"].as<int>() == 0) { st.lastOk = false; return; } // keep last bars
  st.lastOk = true;
  st.s.pct = doc["s"]["p"] | 0; st.s.reset = String((const char*)(doc["s"]["r"] | ""));
  st.w.pct = doc["w"]["p"] | 0; st.w.reset = String((const char*)(doc["w"]["r"] | ""));
  st.f.pct = doc["f"]["p"] | 0; st.f.reset = String((const char*)(doc["f"]["r"] | ""));
  st.haveData = true;
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  Serial.begin(115200);
  canvas.createSprite(W, H);

  C_BG = M5.Display.color565(10, 10, 14);
  C_TRACK = M5.Display.color565(48, 48, 60);
  C_GREEN = M5.Display.color565(61, 220, 132);
  C_AMBER = M5.Display.color565(240, 185, 70);
  C_RED = M5.Display.color565(240, 85, 85);
  C_TEXT = M5.Display.color565(235, 235, 240);
  C_DIM = M5.Display.color565(140, 140, 155);

  render();
}

void loop() {
  M5.update();
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      if (lineBuf.length()) { handleLine(lineBuf); lineBuf = ""; render(); }
    } else if (c != '\r') {
      if (lineBuf.length() < 300) lineBuf += c;
      else lineBuf = ""; // overflow guard
    }
  }
  if (millis() - lastRender > 1000) { lastRender = millis(); render(); }
}
```

- [ ] **Step 4: Build to verify it compiles (no device needed)**

Run: `cd /Users/jonaspauleta/Code/iot/firmware && pio run`
Expected: `SUCCESS`. First run downloads the ESP32 toolchain + M5Unified + ArduinoJson (slow once). If a font symbol is missing, confirm M5Unified resolved to 0.2.x.

- [ ] **Step 5: Flash the device and verify it boots to the waiting screen**

Ensure the M5Stack is connected and nothing else holds the serial port.
Run: `cd /Users/jonaspauleta/Code/iot/firmware && pio run -t upload`
Expected: `SUCCESS`, then the LCD shows `CLAUDE CODE` and centered `Waiting for Mac...`.

- [ ] **Step 6: Commit**

```bash
cd /Users/jonaspauleta/Code/iot
git add firmware/platformio.ini firmware/src/main.cpp
git commit -m "feat: firmware renders usage bars from serial JSON"
```

---

### Task 4: End-to-end bring-up and README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the flashed firmware (Task 3) and `push.js` (Task 2).
- Produces: the working gadget and its run docs.

- [ ] **Step 1: Verify the full pipeline with synthetic frames**

With the device flashed and idle on the waiting screen, run:
`cd /Users/jonaspauleta/Code/iot/mac && node push.js --replay`
Expected: the LCD cycles through the four states every 3s: low bars (green), the 5/59/82 mix (amber/red), near-full (97/88/100 red), then the `ok:0` frame (bars hold, `!` glyph appears). Stop with Ctrl+C.

- [ ] **Step 2: Verify the real pipeline**

Run: `cd /Users/jonaspauleta/Code/iot/mac && npm start`
Expected: within ~3s the LCD shows the real session / week / Fable bars matching `claude -p "/usage"`, the heartbeat dot toggles each poll, and the console logs `sN wN fN` every ~90s. Leave it running or stop with Ctrl+C.

- [ ] **Step 2b: Verify stale handling (optional)**

Stop `npm start`, wait ~4 minutes without any pusher running.
Expected: the LCD dims the bars and shows a red `stale` tag. Restart `npm start` to clear it.

- [ ] **Step 3: Write the README**

Create `README.md`:

```markdown
# M5Stack Claude Code Usage Display

A tethered desk gadget: an M5Stack Core shows live Claude Code plan usage
(current 5h session, current week, current week Fable) as three color-coded
bars. The Mac runs `claude -p "/usage"` on a timer and pushes the parsed
percentages to the device over USB serial. The device is a pure display.

## Prerequisites

- Node 18+ (`node --version`)
- PlatformIO (`pio --version`; install with `brew install platformio`)
- Claude Code logged in (`claude -p "/usage"` prints the three bars)
- An M5Stack Core (Basic) connected over USB

## One-time: flash the firmware

```bash
cd firmware
pio run -t upload
```

The LCD should show `Waiting for Mac...`.

## Run the pusher

```bash
cd mac
npm install
npm start
```

Within a few seconds the three bars appear. Bars are green below 60%, amber
60 to 84%, red at 85% and above.

### Options

- `PORT=/dev/cu.usbserial-XXXX npm start` to pin the serial port.
- `POLL_MS=120000 npm start` to change the poll interval (default 90000).
- `npm run replay` to cycle synthetic frames (no CLI calls) for a visual check.
- `npm run stdout` to print one frame to the terminal instead of serial.

## Tests

```bash
cd mac
npm test
```

## Troubleshooting

- "no usbserial port found": check the cable, or set `PORT=` explicitly.
- Bars never appear but the pusher logs `ok:0`: the `/usage` wording changed;
  update the regexes in `mac/usage-parser.js`.
- Do not run `pio device monitor` while `npm start` is running. They contend
  for the same serial port.
- Each poll runs `claude -p "/usage"` (~2s, counts as ~1 request in your
  stats). Negligible plan impact; raise `POLL_MS` to reduce it further.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jonaspauleta/Code/iot
git add README.md
git commit -m "docs: README with flash, run, and troubleshooting"
```

---

## Self-Review Notes

- Spec coverage: data source via `claude -p "/usage"` (Task 2 step 7), parser + cleanup (Task 1), serial contract (Tasks 2 and 3), 320x240 three-bar layout with thresholds (Task 3), states waiting/ok0-warn/stale (Task 3, verified Task 4), tests parser + toFrame (Tasks 1 and 2), caveats and DTR/RTS + port-contention (push.js comments + README). All covered.
- Placeholder scan: no TBD/TODO; every code step shows complete code.
- Type consistency: `parse` returns `{ ok, session, week, fable }` with `Bar={pct,reset}` (Task 1) and `toFrame` consumes exactly those field names (Task 2); firmware reads the exact short keys `s/w/f/p/r/ok` written by `toFrame` (Task 3).
