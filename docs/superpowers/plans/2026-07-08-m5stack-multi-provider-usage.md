# M5Stack Multi-Provider Usage Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> subagent-driven-development) to implement task-by-task. Steps use checkbox syntax.

**Goal:** Show live coding-plan usage for Claude, Codex, Cursor, and Grok on an M5Stack
Core, one pageable window per provider, driven from the Mac over USB serial.

**Architecture:** Bun on the Mac fetches each provider's usage from its own on-disk creds
(HTTP to internal endpoints), normalizes to a compact multi-window JSON frame, and writes
one line per poll over serial. Arduino/M5Unified firmware pages the windows with the
buttons and renders each provider's bars, extrapolating reset countdowns from a frame
timestamp. Device is a pure renderer.

**Tech Stack:** Bun 1.3+ with `serialport`; PlatformIO with `M5Unified` + `ArduinoJson`;
ESP32 (m5stack-core-esp32).

## Global Constraints

- No em dashes anywhere (prose, code, comments, commits). Use commas, periods, parentheses.
- Runtime: **Bun**, not Node. Scripts run via `bun`. Built-in `fetch` + `Bun.spawn`; the
  only dependency is `serialport`.
- Board `m5stack-core-esp32`, LCD 320x240, landscape (rotation 1). Upload speed 460800.
- Serial: 115200 baud, newline-delimited JSON, one frame per line.
- Serial frame: `{"v":1,"ts":<unix s>,"w":[{"n":<name>,"ok":0|1,"e"?:"reauth|stale|err","b":[{"l":<str>,"p":<int -1..100>,"r":<unix s>}]}]}`.
  Window order fixed: Claude, Codex, Cursor, Grok.
- Bar color thresholds: `p < 50` green, `50 <= p < 80` amber, `p >= 80` red, `p == -1` ghost.
- Secrets: never log/print/commit any token. Only Codex `auth.json` is written back (atomic, 0600).
- Poll cadence default 300000 ms (5 min). Never sub-minute.
- All paths under `/Users/jonaspauleta/Code/iot`.

## File Structure

```
mac/
  lib/keychain.js       readKeychain(service, account) via /usr/bin/security -w
  lib/jwt.js            decodeJwt(token) -> payload object
  lib/grpcweb.js        parseFrames(buf), scanProtobuf(payload), findField(fields, path)
  lib/time.js           toUnixSeconds(isoOrNumber) -> int
  providers/claude.js   parseClaude(json), fetchClaude()
  providers/codex.js    parseCodex(json), fetchCodex()
  providers/cursor.js   parseCursor(json), fetchCursor()
  providers/grok.js     parseGrok(buf), fetchGrok()
  frame.js              buildFrame(windows, nowSec)
  push.js               loop + serial (two-way)
  fixtures/             synthetic per-provider fixtures (no secrets)
  package.json
firmware/platformio.ini, firmware/src/main.cpp
README.md
```

Remove: `mac/usage-parser.js`, `mac/usage-parser.test.js`, `mac/fixtures/usage.txt`.

Dependency order: Task 1 (libs) -> Tasks 2-5 (providers, parallel, each depends only on libs)
-> Task 6 (frame) -> Task 7 (push) -> Task 8 (firmware, depends only on the serial contract)
-> Task 9 (e2e + README + cleanup).

## Shared contracts (every provider conforms)

```
Bar = { l: string, p: number, r: number }   // p int 0..100 or -1 (unknown); r unix seconds or 0
Parsed = { ok: true, bars: Bar[] } | { ok: false, e: 'reauth' | 'stale' | 'err' }
Window = { n: string, ok: boolean, bars: Bar[], e?: string }

// providers/<p>.js
function parse<P>(raw): Parsed              // PURE. raw = JSON object (claude/codex/cursor) or Buffer (grok)
async function fetch<P>(): Promise<Window>  // reads creds + HTTP + parse<P>; NEVER throws
module.exports = { parse<P>, fetch<P> }
```

---

### Task 1: Shared libs

**Files:** Create `mac/package.json`, `mac/lib/keychain.js`, `mac/lib/jwt.js`,
`mac/lib/time.js`, `mac/lib/grpcweb.js`, and `mac/lib/grpcweb.test.js`, `mac/lib/jwt.test.js`.

**Produces:**
- `readKeychain(service, account) -> string | null` (trimmed `-w` output; null on any failure).
- `decodeJwt(token) -> object` (base64url-decode payload segment; throws on malformed).
- `toUnixSeconds(v) -> number` (accepts ISO8601 string, ms epoch, or unix seconds; returns int seconds; 0 on falsy/invalid).
- `parseFrames(buf) -> { data: Buffer[], trailers: string[] }`, `scanProtobuf(payload) -> Field[]` where `Field = { path:number[], wire:number, value:number|bigint }`, `findField(fields, path) -> Field | undefined`.

`package.json`:

```json
{
  "name": "m5-usage",
  "version": "2.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "start": "bun push.js",
    "stdout": "bun push.js --stdout",
    "replay": "bun push.js --replay",
    "test": "bun lib/jwt.test.js && bun lib/grpcweb.test.js && bun providers/claude.test.js && bun providers/codex.test.js && bun providers/cursor.test.js && bun providers/grok.test.js && bun frame.test.js"
  },
  "dependencies": { "serialport": "^12" }
}
```

`lib/keychain.js`:

```js
// Read a generic-password secret from the macOS login Keychain via the system
// `security` binary. Must be the literal /usr/bin/security: some items (Cursor)
// pin their ACL to it, and any other reader triggers a GUI prompt.
function readKeychain(service, account) {
  try {
    const r = Bun.spawnSync(['/usr/bin/security', 'find-generic-password',
      '-s', service, '-a', account, '-w']);
    if (r.exitCode !== 0) return null;
    const out = r.stdout.toString('utf8').trim();
    return out || null;
  } catch {
    return null;
  }
}
module.exports = { readKeychain };
```

`lib/jwt.js`:

```js
// Decode (not verify) a JWT payload. base64url -> JSON.
function decodeJwt(token) {
  const seg = String(token).split('.')[1];
  if (!seg) throw new Error('not a jwt');
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(pad, 'base64').toString('utf8'));
}
module.exports = { decodeJwt };
```

`lib/time.js`:

```js
// Normalize a reset time to integer unix seconds. Accepts ISO8601 string, ms
// epoch number, or unix-seconds number. Returns 0 for falsy/invalid.
function toUnixSeconds(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v > 1e12 ? v / 1000 : v);
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? 0 : Math.round(ms / 1000);
}
module.exports = { toUnixSeconds };
```

`lib/grpcweb.js`:

```js
// Minimal gRPC-web frame splitter + protobuf field scanner. Enough to read
// xAI's GrokBuildBilling response; not a general protobuf decoder.
function parseFrames(buf) {
  const data = [], trailers = [];
  let o = 0;
  while (o + 5 <= buf.length) {
    const flags = buf[o];
    const len = buf.readUInt32BE(o + 1);
    const payload = buf.subarray(o + 5, o + 5 + len);
    o += 5 + len;
    if (flags & 0x80) trailers.push(payload.toString('utf8'));
    else data.push(payload);
  }
  return { data, trailers };
}

// Walk a protobuf message. wire 0 varint, 1 fixed64, 2 length-delim (recurse
// as sub-message when it decodes cleanly), 5 fixed32(float). Returns flat list
// of leaf fields with their tag path.
function scanProtobuf(buf, path = [], out = [], depth = 0) {
  let o = 0;
  while (o < buf.length) {
    const [key, k1] = readVarint(buf, o);
    if (k1 > buf.length) break;
    o = k1;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    const p = path.concat(field);
    if (wire === 0) {
      const [v, n] = readVarint(buf, o); o = n;
      out.push({ path: p, wire, value: v });
    } else if (wire === 5) {
      out.push({ path: p, wire, value: buf.readFloatLE(o) }); o += 4;
    } else if (wire === 1) {
      out.push({ path: p, wire, value: buf.readDoubleLE(o) }); o += 8;
    } else if (wire === 2) {
      const [len, n] = readVarint(buf, o); o = n;
      const sub = buf.subarray(o, o + Number(len)); o += Number(len);
      if (depth < 5 && looksLikeMessage(sub)) scanProtobuf(sub, p, out, depth + 1);
      else out.push({ path: p, wire, value: sub.length });
    } else break;
  }
  return out;
}

function readVarint(buf, o) {
  let shift = 0n, result = 0n;
  while (o < buf.length) {
    const b = BigInt(buf[o++]);
    result |= (b & 0x7fn) << shift;
    if (!(b & 0x80n)) break;
    shift += 7n;
  }
  return [result, o];
}

function looksLikeMessage(buf) {
  if (buf.length === 0) return false;
  const [key, k1] = readVarint(buf, 0);
  if (k1 > buf.length) return false;
  const wire = Number(key & 7n);
  return wire <= 5 && wire !== 3 && wire !== 4;
}

function findField(fields, path) {
  return fields.find((f) => f.path.length === path.length && f.path.every((x, i) => x === path[i]));
}
module.exports = { parseFrames, scanProtobuf, findField, readVarint };
```

`lib/jwt.test.js`: build a synthetic JWT (header/payload/sig, payload `{sub:"user|abc123", exp:9999999999}`), assert `decodeJwt` yields `sub`/`exp`. Assert malformed throws.

`lib/grpcweb.test.js`: hand-build a data frame + trailer (`grpc-status:0`), assert `parseFrames` splits them; feed a small protobuf with a nested float at `[1,x,1]` and a varint at `[1,5,1]`, assert `scanProtobuf`/`findField` locate them.

- [ ] Write files, then `cd mac && bun lib/jwt.test.js && bun lib/grpcweb.test.js` -> both print pass.

---

### Task 2: providers/claude.js

**Consumes:** `readKeychain` (`Claude Code-credentials`, username), `toUnixSeconds`.
**Produces:** `parseClaude(json) -> Parsed`, `fetchClaude() -> Window` (n:"Claude").

`parseClaude(json)` bars (utilization already 0-100):
- `{l:"5h", p: json.five_hour.utilization, r: toUnixSeconds(json.five_hour.resets_at)}`
- `{l:"7d", p: json.seven_day.utilization, r: toUnixSeconds(json.seven_day.resets_at)}`
- Fable: scan `json.limits[]` for `group=="weekly" && kind=="weekly_scoped"` with
  `scope.model.display_name` matching `/opus|fable/i`; use its `percent` + `resets_at`;
  else fall back to `json.seven_day_opus` (`utilization`/`resets_at`). If neither present,
  emit `{l:"Fable", p:-1, r:0}`.
- Missing `five_hour`/`seven_day` -> that bar `p:-1`. If json has none of the expected
  fields -> `{ok:false, e:'err'}`.

`fetchClaude()`:
- token: `JSON.parse(readKeychain('Claude Code-credentials', os.userInfo().username) || readFileSync(~/.claude/.credentials.json)).claudeAiOauth.accessToken`. Missing -> `{n:"Claude",ok:false,bars:[],e:'reauth'}`.
- `GET https://api.anthropic.com/api/oauth/usage` with headers from the spec. 401 -> `reauth`; 429 -> `stale`; other non-200 -> `err`. On success `parseClaude(body)`.
- Wrap everything in try/catch -> `{ok:false,e:'err'}`. Never throw.

**Test** `providers/claude.test.js` with a synthetic fixture (`fixtures/claude.json`) containing
`five_hour`, `seven_day`, and a `limits[]` Fable entry: assert 3 bars, correct pcts, resets as
unix seconds, Fable matched from `limits[]`. Add a fixture missing `limits`/`seven_day_opus`:
assert Fable bar `p:-1`.

- [ ] Write module + test + fixtures, run `bun providers/claude.test.js` -> pass.

---

### Task 3: providers/codex.js

**Consumes:** `toUnixSeconds`. Reads `~/.codex/auth.json` (respect `$CODEX_HOME`).
**Produces:** `parseCodex(json) -> Parsed`, `fetchCodex() -> Window` (n:"Codex").

`parseCodex(json)` bars (used_percent already 0-100, reset_at unix seconds):
- `{l:"5h", p: rate_limit.primary_window.used_percent, r: primary_window.reset_at}`
- `{l:"7d", p: rate_limit.secondary_window.used_percent, r: secondary_window.reset_at}`
- Missing `rate_limit` -> `{ok:false,e:'err'}`; a missing window -> that bar `p:-1`.

`fetchCodex()`:
- read+parse auth.json; extract `tokens.{access_token,refresh_token,account_id}`, `last_refresh`.
- if `Date.now() - Date.parse(last_refresh) > 8*864e5`: refresh (POST auth.openai.com/oauth/token
  per spec), merge into auth.json, set `last_refresh=now`, write atomically (temp file same dir,
  mode 0600, rename). On refresh 401 -> `reauth`.
- `GET https://chatgpt.com/backend-api/wham/usage` with `Authorization`, `ChatGPT-Account-Id`.
  401/403 -> refresh once + retry, then `reauth`. Success -> `parseCodex(body)`.
- Missing auth.json -> `{ok:false,e:'reauth'}`. try/catch -> `err`. Never throw.

**Test** `fixtures/codex.json` (a `rate_limit` with both windows) -> assert 2 bars, pcts, resets.
Do NOT test the network/refresh path (pure parser only).

- [ ] Write module + test + fixture, run `bun providers/codex.test.js` -> pass.

---

### Task 4: providers/cursor.js

**Consumes:** `readKeychain('cursor-access-token','cursor-user')`, `decodeJwt`, `toUnixSeconds`.
**Produces:** `parseCursor(json) -> Parsed`, `fetchCursor() -> Window` (n:"Cursor").

`parseCursor(json)` bars (all reset at `toUnixSeconds(json.billingCycleEnd)`):
- Total: `individualUsage.plan.totalPercentUsed`; fallback chain
  `(auto+api)/2` -> `plan.used/plan.limit*100` -> `individualUsage.overall.used/limit*100`
  -> `teamUsage.pooled.used/limit*100`; none -> `-1`.
- Auto: `individualUsage.plan.autoPercentUsed` (missing -> `-1`).
- API: `individualUsage.plan.apiPercentUsed` (missing -> `-1`).
- No `individualUsage`/`teamUsage` at all -> `{ok:false,e:'err'}`.

`fetchCursor()`:
- token = `readKeychain(...)`; missing -> `{ok:false,e:'reauth'}`.
- `claims = decodeJwt(token)`; if `claims.exp - now < 300` -> `{ok:false,e:'reauth'}`.
- `userId = String(claims.sub).split('|').pop()`; cookie `WorkosCursorSessionToken=${userId}%3A%3A${token}` (do not re-encode).
- `GET https://cursor.com/api/usage-summary` with that `Cookie`. 401/403 -> `reauth`;
  other non-200 -> `err`; success -> `parseCursor(body)`. try/catch -> `err`. Never throw.

**Test** `fixtures/cursor.json` with `individualUsage.plan.{totalPercentUsed,autoPercentUsed,apiPercentUsed}`
+ `billingCycleEnd`: assert 3 bars, pcts, shared reset. Add a legacy fixture without `*PercentUsed`
but with `plan.used`/`plan.limit`: assert Total falls back to the ratio, Auto/API `-1`.

- [ ] Write module + test + fixtures, run `bun providers/cursor.test.js` -> pass.

---

### Task 5: providers/grok.js

**Consumes:** `parseFrames`, `scanProtobuf`, `findField` from `lib/grpcweb`. Reads `~/.grok/auth.json`.
**Produces:** `parseGrok(buf) -> Parsed`, `fetchGrok() -> Window` (n:"Grok").

`parseGrok(buf)`:
- `{data, trailers} = parseFrames(buf)`. If a trailer has `grpc-status:` != 0 -> `{ok:false,e:'reauth'}`.
- `fields = scanProtobuf(data[0])`.
- `usedPercent` = first wire-5 float in [0,100] whose `path` ends in `1`; else if
  `findField(fields,[1,8,1]).value in {1,2}` and some future-dated varint exists -> `0`; else `-1`.
- `reset` = `Number(findField(fields,[1,5,1])?.value || 0)` (unix seconds).
- Return one bar `{l:"Credits", p: usedPercent, r: reset}`. Empty/undecodable -> `{ok:false,e:'err'}`.

`fetchGrok()`:
- read+parse `~/.grok/auth.json` (respect `$GROK_HOME`); pick entry key starting
  `https://auth.x.ai::` else `https://accounts.x.ai/sign-in`; read `.key`, `.expires_at`.
  Missing -> `{ok:false,e:'reauth'}`.
- if `Date.parse(expires_at) <= Date.now()` -> `{n:"Grok",ok:false,bars:[],e:'stale'}`.
- `POST https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig` with the spec's
  headers and body `Buffer.from([0,0,0,0,0])`; read the response as an ArrayBuffer -> Buffer.
  non-200 -> `err`; success -> `parseGrok(buf)`. try/catch -> `err`. Never throw.

**Test** `fixtures/grok-frame.b64` (a recorded/hand-built gRPC-web body: a data frame whose
protobuf has a varint at `[1,5,1]` = a future unix time and `[1,8,1]` = 1, no float) ->
assert `parseGrok` returns one Credits bar with `p:0` and the right reset. Optionally a second
fixture with a float at `[1,x,1]` = 37.5 -> asserts `p:38` (rounded downstream in frame.js;
here assert 37.5 or round in parser — parser returns raw, frame rounds).

- [ ] Write module + test + fixture, run `bun providers/grok.test.js` -> pass.

---

### Task 6: frame.js

**Consumes:** nothing (operates on `Window[]`). **Produces:** `buildFrame(windows, nowSec) -> frame`.

```
buildFrame(windows, nowSec):
  return { v:1, ts: Math.round(nowSec), w: windows.map(mapWindow) }
mapWindow(w):
  base = { n: w.n, ok: w.ok ? 1 : 0, b: (w.bars||[]).map(mapBar) }
  if (!w.ok && w.e) base.e = w.e
  return base
mapBar(b):
  p = (b.p === -1 || b.p == null) ? -1 : clamp(Math.round(b.p), 0, 100)
  return { l: String(b.l), p, r: Math.round(b.r||0) }
```

**Test** `frame.test.js`: a Window with `p:73.4` -> `73`; `p:-1` stays `-1`; `p:130` -> `100`;
a `{ok:false,e:'reauth'}` window -> `{n,ok:0,e:'reauth',b:[]}`; `ts` rounded.

- [ ] Write + `bun frame.test.js` -> pass.

---

### Task 7: push.js

**Consumes:** the four `fetch<P>` + `buildFrame`. **Produces:** the runtime loop; no exports needed
beyond guarding `import.meta.main`.

- Config: `POLL_MS` (default 300000), `PORT`, mode from argv (`--stdout`, `--replay`).
- `tick()`: `const wins = await Promise.all([fetchClaude(),fetchCodex(),fetchCursor(),fetchGrok()])`
  (each already never-throws), `frame = buildFrame(wins, Date.now()/1000)`.
  - `--stdout`: print `JSON.stringify(frame)`, return.
  - else `ensurePort()`, write `JSON.stringify(frame)+'\n'`, log a one-line summary
    (`Claude ok Codex ok Cursor reauth Grok stale`), never the values' internals beyond pct.
- Serial: open once, hold open, prefer `cu.` (carry the v1 findPort `cu.` normalization),
  no DTR/RTS toggle, 2.5s post-open wait, reconnect on error every 3s.
- Two-way: `port.on('data', ...)` accumulate into a small buffer; if it contains `REFRESH`,
  clear buffer and (debounced ~1s) run `tick()` immediately.
- `--replay`: stream synthetic multi-window frames (mix of ok/reauth/stale, low/high pcts,
  a 1-bar Grok) every 3s to exercise every firmware state.
- `import.meta.main` guards the loop start.

- [ ] Write. `bun push.js --stdout` prints one real frame (manual). No unit test (pure glue over tested units).

---

### Task 8: firmware/src/main.cpp + platformio.ini

**Consumes:** the serial frame contract. **Produces:** on-device paging + render.

- `platformio.ini`: env m5stack-core, `upload_speed = 460800`, `monitor_speed = 115200`,
  lib_deps M5Unified@^0.2.7 + ArduinoJson@^7, `build_flags = -DCORE_DEBUG_LEVEL=0`.
- State: `Window win[4]` each `{ char name[12]; bool ok; char e[8]; Bar bar[3]; int nbar; }`,
  `Bar {int p; uint32_t r; char label[10];}`; `int cur` (current window), `uint32_t frameTs`,
  `uint32_t rxMillis`, `bool beat`, `bool haveData`. Keep last-good: on an `ok:0` window with
  empty `b[]`, retain the previous bars for that slot and just mark degraded.
- Parse: read line, `deserializeJson`; require `w` array. For each window by index copy
  `n`,`ok`,`e`,`b[]` (cap 3). Set `frameTs` from `ts`, `rxMillis=millis()`, `haveData=true`,
  toggle `beat`.
- Buttons (`M5.BtnA/B/C.wasPressed()`): A `cur=(cur+3)%4`, C `cur=(cur+1)%4`, B
  `Serial.print("REFRESH\n")` + set a short-lived "refreshing" flag for the cue.
- Relative time: `nowSec = frameTs + (millis()-rxMillis)/1000; rem = r>nowSec ? r-nowSec : 0;`
  format `>=1d` -> `Nd`, else `Hh Mm`, else `Mm`, else `now`.
- Render current window to the 8-bit sprite (fallback direct-draw): header (provider name,
  four index dots with `cur` highlighted, heartbeat), then `nbar` bars top-aligned (single bar
  centered). Each bar: label (left), pct (right, `--` if `p==-1`), track + fill
  (`barColor(p)`, ghost if `-1`), relative reset under it. Degraded window: dim text + show
  `e` tag; if no last-good bars, centered message (`reauth` -> "run the CLI", `stale`, `err`).
- `barColor`: `p>=80` red, `p>=50` amber, else green; `p==-1` neutral.
- No frame yet: `Waiting for Mac...`.

- [ ] `cd firmware && ~/.local/bin/pio run` compiles. Then `pio run -t upload` (port free).

---

### Task 9: End-to-end, README, cleanup

- [ ] Remove `mac/usage-parser.js`, `mac/usage-parser.test.js`, `mac/fixtures/usage.txt`.
- [ ] `cd mac && bun run test` -> all unit tests pass.
- [ ] `bun push.js --stdout` -> one real frame with all four windows (some may be reauth/stale).
- [ ] Flash firmware; `bun push.js --replay` -> page through all four windows, verify colors,
  degraded tags, single-bar Grok, and Btn B triggers an immediate real tick.
- [ ] `bun start` -> live windows; page with A/C; press B to force refresh.
- [ ] Rewrite `README.md`: Bun, four providers, per-provider one-time login note, the Keychain
  "Always Allow" setup step, buttons, port-contention caveat, `POLL_MS`.

## Self-Review Notes

- Spec coverage: libs (T1), all four providers with exact endpoints/auth/bars (T2-5),
  normalization frame (T6), loop + two-way serial (T7), paging/render/buttons/colors/states (T8),
  cleanup + e2e + docs (T9). Security (no token logging; only Codex writeback) in T3 + constraints.
- Placeholder scan: none. Load-bearing code (libs, frame) shown in full; providers specified by
  exact field paths + fetch recipe + test expectations.
- Type consistency: `Bar{l,p,r}`, `Parsed`, `Window{n,ok,bars,e?}` uniform across T2-6; frame
  short keys `{n,ok,e?,b:[{l,p,r}]}` match what the firmware (T8) reads; `ts`/`frameTs` unix seconds.
```
