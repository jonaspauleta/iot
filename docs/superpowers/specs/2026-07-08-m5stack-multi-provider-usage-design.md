# M5Stack Multi-Provider Usage Display — Design Spec

Date: 2026-07-08
Status: Approved for planning
Supersedes: `2026-07-08-m5stack-claude-usage-design.md` (single-provider v1)

## Summary

A tethered desk gadget. An M5Stack Core (Basic Kit V2.6) shows live coding-plan
usage for four providers, one "window" per provider: Claude, Codex, Cursor, Grok.
Each window renders that provider's rate-limit / quota as color-coded progress bars
with reset times. The user pages between windows with the hardware buttons. The Mac
does all the work (fetch, auth, normalize); the device is a pure renderer.

This extends the working single-provider v1 (which showed only Claude's three bars).

## Goals

- Show one window per provider. Fixed order: Claude, Codex, Cursor, Grok. Boot on Claude.
- Each window shows that provider's usage windows as bars (label, percent, fill, reset):
  - Claude: SESSION 5h, WEEK all-models, WEEK Fable/Opus.
  - Codex: SESSION 5h, WEEK 7d.
  - Cursor: Total, Auto+Composer, API.
  - Grok: Credits (single bar).
- Buttons: left (A) = previous window, right (C) = next window, middle (B) = force
  an immediate re-poll now.
- Data is fetched locally on the Mac from each provider's own on-disk credentials.
  No GUI, no browser at fetch time.

## Non-goals (v1)

- No dollar/token cost bars. Usage/quota windows only (per decision). Cost/overage
  metrics (Claude extra_usage, Cursor on-demand spend, Grok credit dollars) are out.
- No standalone WiFi mode. Device stays USB-tethered.
- No history/sparkline.
- push.js does not write provider tokens back to disk/Keychain except Codex (see Auth).

## Hardware

- Board: M5Stack Basic Kit V2.6 = original M5Stack Core. ESP32-D0WDQ6 (no PSRAM),
  320x240 LCD (ILI9342C), 3 buttons (A/B/C), CP2104 USB-serial.
- On this Mac: `/dev/cu.usbserial-56750019571` (suffix can change; push.js auto-detects
  a `usbserial` port and prefers the `cu.` device over `tty.`).

## Toolchain

- Mac side: **Bun** (verified 1.3.14 here). Uses Bun's built-in `fetch` and `Bun.spawn`.
  **Zero dependencies.** The `serialport` native module crashes under Bun when the port is
  opened/streamed (libuv `uv_default_loop` unsupported, bun#18546; `SerialPort.list()` works
  but `.open()` does not), so the serial line is driven directly through the tty via `stty`
  (line config) + a held-open non-blocking `fs` fd (`lib/serial.js`). One fd held open means
  the ESP32 auto-resets only once, at open.
- Firmware: PlatformIO, `board = m5stack-core-esp32`, `framework = arduino`,
  libs `M5Unified` + `ArduinoJson`. Upload speed 460800 (this CP2104 corrupts at 921600).

## Architecture

```
per provider: read on-disk creds -> HTTP fetch -> parse -> bars
                         |
push.js gathers 4 windows -> buildFrame -> one JSON line over USB serial (115200)
                         |
firmware pages windows, renders bars, extrapolates reset countdowns, sends REFRESH on Btn B
```

Units, each independently understandable and testable:

1. `lib/*` — pure helpers: Keychain read, JWT decode, gRPC-web frame + protobuf scan.
2. `providers/<p>.js` — per provider: a pure `parse<P>(raw)` (response in, bars out, no I/O)
   plus a `fetch<P>()` wrapper (creds + HTTP + parse, never throws).
3. `frame.js` — pure `buildFrame(windows, nowSec)` -> the serial frame (normalize, clamp,
   ISO/unix -> unix seconds).
4. `push.js` — the loop: fetch all four, frame, write serial; listen for REFRESH from device.
5. `firmware` — read serial line, parse JSON, page + render. No network, no fetch logic.

### Data sources (all verified live on this Mac, HTTP 200)

All four are the same internal endpoints CodexBar uses. They are undocumented /
reverse-engineered internal APIs (same off-label class as the v1 text-scraping). Expect
occasional maintenance if a provider changes shape. Poll cadence stays multi-minute
(default 5 min) to avoid 429 / anti-abuse.

#### Claude (switched from `claude -p "/usage"` to the OAuth endpoint)

- Token: macOS Keychain, service `Claude Code-credentials`, account = current username.
  Read via `/usr/bin/security find-generic-password -s "Claude Code-credentials" -a <user> -w`,
  then `JSON.parse(raw).claudeAiOauth.accessToken`. Fall back to
  `~/.claude/.credentials.json` (same `{claudeAiOauth:{...}}` shape) if the Keychain read
  is empty. Read every tick (cheap; token is short-lived ~1h and the real `claude` CLI
  keeps it fresh).
- Auth: OAuth bearer. Do NOT self-refresh / write back to the Keychain (the CLI owns and
  rotates it; racing its rotating refresh token can log the user out). If expired and the
  Keychain has not been refreshed, surface a `reauth` state ("run `claude`").
- Fetch: `GET https://api.anthropic.com/api/oauth/usage`
  Headers: `Authorization: Bearer <token>`, `Accept: application/json`,
  `Content-Type: application/json`, `anthropic-beta: oauth-2025-04-20`,
  `User-Agent: claude-code/2.1.0`.
- Bars (each window object is `{utilization: 0-100 float, resets_at: ISO8601}`):
  - SESSION 5h: `five_hour.utilization`, reset `five_hour.resets_at`.
  - WEEK all: `seven_day.utilization`, reset `seven_day.resets_at`.
  - WEEK Fable: scan `limits[]` for `group=="weekly" && kind=="weekly_scoped"` whose
    `scope.model.display_name` matches `/opus|fable/i` (substring; the promo name rotates);
    else fall back to `seven_day_opus.utilization`. Reset from the matched entry.
- Status: 401 -> `reauth`; 429 -> back off (skip tick), respect `Retry-After`.

#### Codex (ChatGPT/Codex plan rate limits)

- Token: `~/.codex/auth.json` (respect `$CODEX_HOME`). Keys: `tokens.access_token`,
  `tokens.refresh_token`, `tokens.account_id`, top-level `last_refresh` (ISO8601).
- Auth: OAuth bearer. Refresh ONLY if `now - last_refresh > 8 days` (CodexBar's rule):
  `POST https://auth.openai.com/oauth/token`, JSON body
  `{client_id:"app_EMoamEEZ73f0CkXaXp7hrann", grant_type:"refresh_token", refresh_token, scope:"openid profile email"}`;
  on 200 merge new `access_token`/`refresh_token`/`id_token` back into auth.json
  (preserve `account_id`/`auth_mode`), set `last_refresh = now`, write atomically
  (temp file, mode 0600, rename). This is the only provider we write back, and it mirrors
  what the `codex` CLI itself does, so it is safe. Currently ~5 days old (no refresh needed
  for ~3 days).
- Fetch: `GET https://chatgpt.com/backend-api/wham/usage`
  Headers: `Authorization: Bearer <token>`, `ChatGPT-Account-Id: <account_id>`,
  `Accept: application/json`.
- Bars (`rate_limit.{primary,secondary}_window` each `{used_percent: 0-100, reset_at: unix s}`):
  - SESSION 5h: `rate_limit.primary_window.used_percent`, reset `.reset_at`.
  - WEEK 7d: `rate_limit.secondary_window.used_percent`, reset `.reset_at`.
- Status: 401/403 -> refresh once and retry; still failing -> `reauth`.

#### Cursor (Keychain JWT -> derived WorkOS cookie)

- Token: macOS Keychain, service `cursor-access-token`, account `cursor-user`, read via
  `/usr/bin/security ... -w` (the item's ACL is pinned to `/usr/bin/security`, so any other
  reader triggers a GUI prompt — must shell out to that exact binary).
- Auth: JWT (base64url-decode segment[1]) -> `claims.sub`, `claims.exp`.
  `userId = claims.sub.split('|').pop()`.
  Cookie: `WorkosCursorSessionToken=<userId>%3A%3A<accessToken>` (send `%3A%3A` literally,
  do not re-encode). Token lasts ~60 days; NO refresh flow exists (CodexBar has none either).
  If `exp` within ~300s or 401/403 -> `reauth` ("run `cursor-agent login`").
- Fetch: `GET https://cursor.com/api/usage-summary`, headers `Cookie: <above>`,
  `Accept: application/json`.
- Bars (all reset at `billingCycleEnd` ISO8601):
  - Total: `individualUsage.plan.totalPercentUsed`
    (fallback chain: `(autoPercentUsed+apiPercentUsed)/2` -> `plan.used/plan.limit*100`
    -> `individualUsage.overall.used/limit*100` -> `teamUsage.pooled.used/limit*100`).
  - Auto+Composer: `individualUsage.plan.autoPercentUsed`.
  - API: `individualUsage.plan.apiPercentUsed`.
  Legacy request-based plans do not populate the `*PercentUsed` floats; the fallback chain
  handles that (missing -> that bar is `-1` unknown rather than crashing).

#### Grok (xAI internal gRPC-web billing; official `x.ai/billing` path is broken)

The documented `grok agent stdio` JSON-RPC path returns `-32601 Method not found` even on
CLI 0.2.91. Do not use it. Use the web billing endpoint.

- Token: `~/.grok/auth.json` (respect `$GROK_HOME`). It is keyed by OIDC scope URL; pick the
  entry whose key starts with `https://auth.x.ai::`, else `https://accounts.x.ai/sign-in`.
  Read `.key` (bearer) and `.expires_at` (ISO8601). Access token lives only ~6h; no client
  refresh exists (the `grok` CLI refreshes on use). If `expires_at <= now` -> keep last
  value with `stale` flag.
- Fetch: `POST https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig`
  Headers: `Authorization: Bearer <key>`, `Content-Type: application/grpc-web+proto`,
  `x-grpc-web: 1`, `Origin: https://grok.com`, `Referer: https://grok.com/?_s=usage`,
  `Accept: */*`, `x-user-agent: connect-es/2.1.1`.
  Body: exactly 5 bytes `Buffer.from([0,0,0,0,0])` (empty gRPC-web frame).
- Parse: response is gRPC-web framed (`[flags:1][len:4 BE][payload]`). Data frames have
  `flags & 0x80 == 0`; trailer frames (`flags & 0x80`) carry `grpc-status`. Run a small
  recursive protobuf scanner over the data frame payload:
  - `usedPercent` = first wire-type-5 float32 in [0,100] whose field path ends in index 1;
    if none present but varint at path `[1,8,1] in {1,2}` (a current period exists) and a
    plausible future reset varint exists -> `usedPercent = 0` (proto3 default-omit == 0%).
  - reset = varint at path `[1,5,1]` (unix seconds).
- Bar: `Credits` (single). Label window Weekly/Monthly by the start->end gap (observed 7d).
- Status: non-200 or `grpc-status != 0` -> `stale` (keep last) or `reauth`.

### Serial contract (one JSON line, newline-terminated)

Short keys, integers, all four windows every frame. ~350 bytes, ~30 ms at 115200.

```json
{"v":1,"ts":1751990400,"w":[
  {"n":"Claude","ok":1,"b":[{"l":"5h","p":42,"r":1751998800},{"l":"7d","p":68,"r":1752566400},{"l":"Fable","p":31,"r":1752566400}]},
  {"n":"Codex","ok":1,"b":[{"l":"5h","p":12,"r":1751995200},{"l":"7d","p":55,"r":1752560000}]},
  {"n":"Cursor","ok":1,"b":[{"l":"Total","p":73,"r":1754006400},{"l":"Auto","p":60,"r":1754006400},{"l":"API","p":13,"r":1754006400}]},
  {"n":"Grok","ok":0,"e":"stale","b":[{"l":"Credits","p":0,"r":1752560000}]}
]}
```

- `v` schema version. `ts` frame build time, unix seconds (device extrapolates now from this + `millis()`).
- `w[]` windows in fixed order. `n` name. `ok` 1=fresh, 0=degraded. `e` optional state
  when `ok=0`: `"reauth" | "stale" | "err"`. `b[]` bars.
- Bar: `l` short label, `p` int 0-100 (or `-1` unknown/uncapped -> ghost bar), `r` reset
  unix seconds (0 = none).

### Normalization (frame.js, Mac side)

- Native percent -> `Math.round`, clamp [0,100].
- used/limit ratios -> `round(used/limit*100)`; null/unlimited limit -> `p:-1`.
- All resets converted to unix seconds on the Mac (ISO for Claude/Cursor, unix for
  Codex/Grok) so the wire is always int.
- A window that could not be fetched: `ok:0` + `e`; `b[]` may be empty (reauth) or carry
  last-known values (stale). Firmware keeps its own last-good per window and never blanks
  mid-cycle on a transient error.

### Firmware

- Parse the frame with ArduinoJson. Store up to 4 windows, each with up to 3 bars and its
  own last-good retention. Stamp `frameTs` + `rxMillis` on receipt.
- Relative reset: `nowSec = frameTs + (millis() - rxMillis)/1000`; show `r - nowSec` as
  `"4h 12m"`, `"3d"`, or `"now"`. Uniform across providers.
- Paging: BtnA prev, BtnC next (wrap). Header shows provider name + index dots
  (e.g. the current window highlighted among four) + heartbeat dot toggling per frame.
- BtnB: write `REFRESH\n` to Serial and flash a brief "refreshing" cue. push.js re-polls on it.
- Per window: draw `b.length` bars (1 to 3), top-aligned; a single bar (Grok) centered.
  Degraded (`ok:0`): dim, show the `e` tag (`reauth` / `stale`) and last-good bars if any,
  else a centered message.
- Colors (RGB565): `p < 50` green, `50 <= p < 80` amber, `p >= 80` red; `p == -1` neutral ghost.
- 8-bit full-screen M5Canvas sprite (75 KB fits internal RAM; the 16-bit 150 KB one does
  not on the PSRAM-less Core), with a direct-draw fallback if even that fails.
- States: no frame yet -> `Waiting for Mac...`; frame with all windows -> render current.

### push.js loop

- `POLL_MS` default 300000 (5 min). `PORT` override. Modes: default loop, `--stdout`
  (build one real frame, print, exit), `--replay` (synthetic frames for a visual pass).
- Each tick: `Promise.allSettled([fetchClaude, fetchCodex, fetchCursor, fetchGrok])`,
  `buildFrame`, write serial line. A rejected/failed provider becomes an `ok:0` window;
  the tick never dies because one provider failed.
- Serial two-way: on device `data`, if the accumulated input contains `REFRESH`, debounce
  and run an immediate tick. Ignore all other device output (boot chatter).
- Open the port once (via `lib/serial.js`: `stty` config + non-blocking `fs` fd), hold it
  open, prefer `cu.`, never toggle DTR/RTS. Poll the fd (~200 ms) for the device's `REFRESH`.

## Security

- Tokens are read from the user's own on-disk creds / Keychain. Never logged, never printed,
  never committed. Only Codex's auth.json is written back (atomic, 0600), mirroring its CLI.
- First run under launchd/cron may trigger a one-time macOS "confidential information"
  Keychain prompt for the Bun binary (Claude + Cursor items). Click "Always Allow". Documented
  as a setup step.
- All four endpoints are unofficial internal APIs; this is the same off-label posture as v1.

## Error handling summary

| Failure | Where | Behavior |
|---|---|---|
| Provider token expired/missing | provider fetch | window `ok:0` `e:"reauth"`; device dims + tag |
| Grok/Claude token stale (idle CLI) | provider fetch | window `ok:0` `e:"stale"`; keep last bars |
| Provider HTTP/parse error | provider fetch | window `ok:0` `e:"err"`; keep last bars |
| One provider down | push.js | other three still render; frame still sent |
| Device unplugged | push.js | close port, retry open every 3s |
| Boot chatter on serial | firmware | non-JSON lines ignored |
| No frame yet | firmware | `Waiting for Mac...` |

## Testing

- `lib/grpcweb` self-check: feed a recorded gRPC-web response buffer (base64 fixture,
  no secrets) -> assert extracted `usedPercent` and reset. This is the one gnarly parser.
- `lib/jwt` self-check: decode a synthetic (non-secret) JWT -> assert `sub`/`exp`.
- Each `parse<P>(raw)` self-check: feed a synthetic response object matching the documented
  shape -> assert the expected bars (labels, pct, reset unix seconds). Include a
  degraded/missing-field case -> asserts the `-1`/fallback behavior.
- `frame.js` self-check: assert normalization (clamp, ISO->unix, `ok:0` shaping).
- `push.js --stdout`: manual, prints one real frame from live creds.
- `push.js --replay` + firmware: manual visual pass over paging, colors, degraded tags,
  the REFRESH button.

## Project layout

```
iot/
  firmware/
    platformio.ini
    src/main.cpp
  mac/
    lib/{keychain,jwt,time,grpcweb,serial}.js  (+ jwt/grpcweb .test.js)
    providers/{claude,codex,cursor,grok}.js  (+ .test.js)
    frame.js  (+ frame.test.js)
    push.js
    package.json          # bun scripts; zero dependencies
    fixtures/             # synthetic response fixtures (no secrets)
  docs/superpowers/specs/2026-07-08-m5stack-multi-provider-usage-design.md
  docs/superpowers/plans/2026-07-08-m5stack-multi-provider-usage.md
  README.md
```

Removed from v1: `usage-parser.js` / `.test.js` / `fixtures/usage.txt` (Claude no longer
scrapes CLI text).

## Caveats

- Idle-CLI staleness: Cursor (60-day token, then manual `cursor-agent login`) and Grok
  (6h token, refreshed only by running `grok`) cannot self-heal from push.js. If the user
  goes quiet on either, that window shows stale/reauth until they touch the CLI.
- Grok is a single bar; it renders centered rather than padded to three.
- Keep poll cadence multi-minute; these endpoints throttle.
```
