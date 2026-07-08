# M5Stack Claude Code Usage Display — Design Spec

Date: 2026-07-08
Status: Approved for planning

## Summary

A tethered desk gadget. An M5Stack Core (Basic Kit V2.6) displays live Claude Code
plan usage as three progress bars, mirroring the `/usage` screen: current 5-hour
session, current week (all models), current week (Fable). The Mac does all the
work; the device is a display.

## Goal

Show, on the M5Stack LCD, the same three bars the `/usage` command shows:

```
Current session: 5% used · resets Jul 8 at 6:19pm (Europe/Lisbon)
Current week (all models): 59% used · resets Jul 10 at 3am (Europe/Lisbon)
Current week (Fable): 82% used · resets Jul 10 at 3am (Europe/Lisbon)
```

Each bar: a label, a percent, a fill, and a reset time.

## Non-goals (v1)

- No dollar/token cost view (ccusage). Reserved as a stretch button view.
- No standalone WiFi mode. The device stays USB-tethered to the Mac.
- No button interaction. Buttons A/B/C are unused in v1.
- No daily sparkline / history.

## Hardware

- Board: M5Stack Basic Kit V2.6 = original M5Stack Core.
  - ESP32-D0WDQ6, 320x240 LCD (ILI9342C), speaker, microSD, 3 physical buttons
    (A/B/C), CP2104 USB-serial.
- Connection on this Mac: `/dev/cu.usbserial-56750019571`.
  - The suffix can change across reboots/ports. `push.js` auto-detects by matching
    a `usbserial` port, with an env override.

## Architecture

```
claude -p "/usage"  ->  push.js parses 3 lines  ->  JSON line over USB serial  ->  firmware renders 3 bars
   (~2s, every ~90s)        regex                     115200 baud, newline-delim     M5Unified sprite
```

Three units, each independently understandable and testable:

1. `usage-parser.js` — pure function. Text in, structured usage out. No I/O.
2. `push.js` — the loop: run the CLI, parse, frame, write serial, handle failure.
3. `firmware` — read serial lines, parse JSON, render. No network, no logic beyond
   display and state.

### Data source: `claude -p "/usage"`

The `/usage` slash command runs headless in print mode and prints the bars as plain
text (verified: ~2s per call, stable output). No OAuth token, no HTTP endpoint, no
TUI scraping.

- Invocation: `claude -p "/usage"` with `stdin` = `/dev/null`, `cwd` = a trusted
  directory (avoids the workspace-trust prompt), timeout ~15s.
- The data is "approximate, based on local sessions on this machine" — exactly what
  the `/usage` screen shows.

### `usage-parser.js`

Pure function `parse(text) -> Result`:

```js
// Result
{
  ok: true,
  session: { pct: 5,  reset: "Jul 8 6:19pm" },
  week:    { pct: 59, reset: "Jul 10 3am" },
  fable:   { pct: 82, reset: "Jul 10 3am" },
}
// on failure to find all three lines: { ok: false }
```

Line regexes (case-insensitive, `·` is U+00B7):

- session: `Current session:\s*(\d+)%\s*used\s*·\s*resets\s*(.+)`
- week:    `Current week \(all models\):\s*(\d+)%\s*used\s*·\s*resets\s*(.+)`
- fable:   `Current week \(Fable\):\s*(\d+)%\s*used\s*·\s*resets\s*(.+)`

Reset cleanup on the captured group: drop trailing ` (Timezone)` with
`/\s*\([^)]*\)\s*$/`, remove the word ` at `, collapse whitespace. Yields
`"Jul 8 6:19pm"`, `"Jul 10 3am"`.

`ok` is true only if all three lines matched. A partial match returns `ok:false`
(we do not display half-stale bars as current).

### `push.js`

The loop. Node, dependency: `serialport`.

- Config via env: `PORT` (serial path, default auto-detect `usbserial`),
  `POLL_MS` (default 90000), `CLAUDE_CWD` (trusted dir for the CLI call).
- Open the serial port **once** at startup and keep it open across polls:
  - `baudRate: 115200`.
  - Do **not** toggle DTR/RTS. Opening resets the ESP32 once at startup (fine);
    reopening every poll would reset it every poll, so we hold the handle open.
- Each tick:
  1. `execFile('claude', ['-p', '/usage'], { cwd, timeout, stdin ignored })`.
  2. `parse(stdout)`.
  3. Build the compact frame (below), write it + `\n` to the port.
  4. On CLI failure/timeout or `parse().ok === false`: write `{"ok":0}` (firmware
     keeps last-good bars). Log to Mac console.
- On serial write/port error (e.g. device unplugged): close, retry opening every 3s.

Flags:

- `--stdout` — print the JSON frame to stdout instead of writing serial (for
  verifying extraction against real `claude -p "/usage"`).
- `--replay` — stream synthetic frames on a timer (0% / 82% / 100% / an `ok:0` /
  a gap) to eyeball every firmware state without touching the real CLI.

### Serial contract (one JSON line, newline-terminated)

Short keys to keep the line small:

```json
{"s":{"p":5,"r":"Jul 8 6:19pm"},"w":{"p":59,"r":"Jul 10 3am"},"f":{"p":82,"r":"Jul 10 3am"},"ok":1}
```

- `s`/`w`/`f` = session / week-all / week-Fable. `p` = percent int, `r` = reset string.
- `ok` = 1 when the frame carries fresh parsed data; `ok:0` frames omit `s`/`w`/`f`.

### Firmware

PlatformIO project. `platform = espressif32`, `board = m5stack-core-esp32`,
`framework = arduino`. Libraries: `M5Unified`, `ArduinoJson`.

- Serial: 115200. Read chars into a bounded buffer (~256 B) until `\n`, then parse
  with ArduinoJson. Non-JSON lines (ESP32 boot chatter) fail to parse and are
  ignored. On a valid `ok:1` line, store the three bars and stamp `lastRxMillis`.
  On `ok:0`, refresh `lastRxMillis` but keep the stored bars.
- Render to an off-screen `M5Canvas` sprite (320x240) then `pushSprite(0,0)` —
  flicker-free.

#### Layout (320x240)

- Header, y 0..26: `CLAUDE CODE` (left), heartbeat dot (right, ~x300, toggles each
  received line).
- Three blocks, start y=32, height 66 each:
  - Label line (y+0): e.g. `SESSION · 5h`, with the percent right-aligned on the
    same line (`5 %`).
  - Bar (y+20): track x 12..308 (width 296), height 16, rounded. Fill width =
    `round(pct/100 * 296)`, clamped to [0,296].
  - Reset line (y+40): small gray `resets <r>`.
- Block labels: `SESSION · 5h`, `WEEK · all models`, `WEEK · Fable`.

#### Colors (RGB565)

Fill color by threshold, so a bar reads its own status:

- `pct < 60` green
- `60 <= pct < 85` amber
- `pct >= 85` red

Track is a dark gray. Thresholds are constants, easy to tune.

#### States

- Boot, no line yet (`lastRxMillis == 0`): centered `Waiting for Mac...`.
- `ok:0` received: keep last bars, draw a small warning glyph near the heartbeat.
  If no good data ever arrived, stay on `Waiting for Mac...`.
- Stale: if `millis() - lastRxMillis > 240000` (4 min), dim the sprite and draw a
  `stale` tag. (4 min > default 90s poll, so a couple of missed polls before we
  flag it.)

## Error handling summary

| Failure | Where | Behavior |
|---|---|---|
| `claude -p` errors/times out | push.js | send `ok:0`; firmware keeps last bars + warn glyph |
| `/usage` text unparseable | usage-parser | `ok:false` -> push sends `ok:0` |
| Device unplugged | push.js | close port, retry open every 3s |
| Boot chatter on serial | firmware | non-JSON lines ignored |
| No data for >4 min | firmware | dim + `stale` |
| Fresh boot, no data yet | firmware | `Waiting for Mac...` |

## Testing

- `usage-parser` self-check (assert-based, no framework): feed the captured
  three-line sample from `mac/fixtures/usage.txt`; assert
  `{s:5, w:59, f:82}` and the cleaned reset strings. Assert a truncated/partial
  input returns `ok:false`. This is the one piece of non-trivial logic (regex
  parsing), so it gets the runnable check.
- `push.js --stdout`: manual check that real `claude -p "/usage"` -> correct frame.
- `push.js --replay`: manual visual pass over each firmware state on the device.
- Firmware: manual visual verification on the device (green/amber/red, waiting,
  stale, warn glyph).

## Caveats

- Each poll spends ~2s and counts as ~1 request in your stats. Negligible plan
  impact; `POLL_MS` default 90s keeps self-inflicted load low.
- Parsing depends on the `/usage` wording. One regex per line is the single point
  of failure and is trivial to fix if Anthropic reword it. The "Fable" label tracks
  whatever the premium tier is named.
- push.js holds the serial port open and does not toggle DTR/RTS, so it resets the
  ESP32 only once at startup, never mid-run.
- Do not run a PlatformIO serial monitor while `push.js` is running — they contend
  for the same port.

## Project layout

```
iot/
  firmware/
    platformio.ini
    src/main.cpp
  mac/
    push.js
    usage-parser.js
    package.json          # serialport; "start" script
    fixtures/usage.txt    # captured /usage output for the parser self-check
  docs/superpowers/specs/2026-07-08-m5stack-claude-usage-design.md
  README.md               # flash firmware, run push.js, port-contention note
```

## Stretch (post-v1)

- Buttons A/B/C flip to a second view: token/cost from ccusage.
- 7-day sparkline.
- launchd plist to auto-start push.js at login.
- Standalone WiFi mode (device pulls from a small server on the Mac).
