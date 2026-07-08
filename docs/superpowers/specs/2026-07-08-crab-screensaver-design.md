# Crab Screensaver — Design

M5Stack Core usage display gets an idle screensaver featuring Clawd, Claude's
orange crab, drawn procedurally and animated.

## Behavior

- **Enter:** 30 seconds after the last button press (`SAVER_MS = 30000`), the
  screensaver replaces the bars screen. Since buttons are rarely pressed, the
  crab is effectively the device's resting face.
- **Exit:** any button press (A, B, or C) wakes back to the bars screen. The
  waking press is consumed: it does not also change page or send REFRESH.
- **Data flow unchanged:** serial frames are still parsed during the saver
  (`handleLine` as today), but they neither force a re-render of bars nor wake
  the saver. On wake, the freshest data renders as usual.
- Boot counts as a "button press" (device shows bars/waiting screen first,
  saver kicks in 30s later).

## Scene

- Dark background, same `C_BG` as the bars screen.
- One large Clawd centered, roughly 120px wide, built from graphics
  primitives on the existing 8-bit sprite: rounded orange body, two stalk
  eyes, two claws, small legs. Coral/orange palette added alongside the
  existing color constants.
- Nothing else on screen: no text, no usage hint, no clock.

## Animation (~15 fps while saver is active)

- **Bob:** body and attached parts move vertically a few pixels on a sine of
  `millis()`.
- **Blink:** eyes closed for ~150 ms every 3–4 s.
- **Claw wave:** occasionally one claw raises and lowers over ~1 s.

All timing derives from `millis()`; no RTC, no extra state beyond a few
timestamps.

## Non-goals

- No brightness dimming, no position drift (TFT, burn-in is a non-issue), no
  usage-reactive moods, no bitmap assets, no new files or dependencies.

## Code shape

Stays in `firmware/src/main.cpp`:

- `drawCrab(g)` renders the scene from primitives using `millis()`-derived
  phases.
- `loop()` tracks `lastBtnMillis`, derives `saverActive`, consumes the waking
  press, and while active renders the crab at ~66 ms intervals instead of the
  1 s bars tick.

## Testing

Firmware has no test harness; verification is: build with `pio run`, flash,
observe saver enters after 30 s idle, animates smoothly, and any button
returns to bars with the press consumed.
