# OpenCode Logo Screensaver and Provider Marks

Date: 2026-09-03
Status: Design approved, pending written-spec review

## Summary

Replace the idle Clawd crab scene on the M5Stack with a restrained OpenCode
square mark. Add a compact provider mark beside the active provider name on
each usage page. The device remains a pure renderer, and the Mac-side frame
format does not change.

## Goals

- Show a recognizable OpenCode square mark while the device is idle.
- Keep the screensaver calm and legible on the 320x240 LCD.
- Show a small active-provider mark for Claude, Codex, Cursor, and Grok.
- Preserve existing saver timing, button behavior, paging, refresh behavior,
  serial parsing, and sprite fallback.
- Keep the change contained to `firmware/src/main.cpp`.

## Non-goals

- No bitmap assets, fonts, or new dependencies.
- No changes to the Mac pusher, provider parsers, frame schema, or serial
  protocol.
- No changes to the 30-second idle threshold or the 15 fps saver tick.
- No provider-specific network or authentication logic on the device.
- No usage-reactive animation, burn-in mitigation, or brightness changes.

## Behavior

### Screensaver entry and exit

The existing state machine remains unchanged:

- The saver begins after `SAVER_MS` (30 seconds) without a button press.
- Any button wakes the usage screen, and the waking press is consumed.
- Serial frames continue to be parsed while the saver is active but do not
  wake it or force a usage-screen render.
- Boot still counts as the initial button timestamp.
- The saver continues to render at approximately 15 fps. Usage pages continue
  to render at approximately 1 Hz.

### Idle scene

`drawCrab()` is replaced by `drawOpenCodeMark()` in the existing render
dispatch. The scene contains only the existing dark background and one
centered block mark:

- The mark is a 7x7 grid with five filled blocks across the top and bottom,
  plus filled blocks down both sides. The stepped corners match the square
  direction selected in the visual companion.
- Each block is drawn with existing M5GFX primitives. No image data is stored
  in flash or RAM.
- The mark is approximately 100 to 115 pixels wide, centered on the LCD, and
  rendered in a neutral light gray distinct from the usage bars.
- The mark moves vertically by only a few pixels on a sine phase derived from
  `millis()`. It does not rotate, blink, wave, or react to usage data.
- The scene has no text, status indicator, provider name, or button hint.

### Provider header mark

The current provider name remains the source of truth. `drawUI()` draws a
small mark before the name using the existing `Win.n` value:

- Claude uses a coral mark.
- Codex uses a mint mark representing the OpenAI/Codex identity.
- Cursor uses a light neutral mark.
- Grok uses a blue mark.
- The marks are compact procedural glyphs optimized for the LCD, not external
  bitmap logos. Each is drawn within a roughly 12x12 pixel footprint, followed
  by a small gap before the provider name.
- An unexpected provider name falls back to a neutral compact square, so a
  malformed or future window cannot leave stale provider branding on screen.
- Degraded and stale states still use the existing tag, heartbeat, dimming, and
  last-good bars. Only the provider mark and name identify the page.

The header layout shifts the provider name to the right by the mark width. The
right-side heartbeat and error/refresh tags keep their existing positions.

## Architecture

All changes remain in `firmware/src/main.cpp`:

- Replace `C_CRAB` with an OpenCode mark color and add the four provider mark
  colors.
- Replace `drawCrab(G&)` with `drawOpenCodeMark(G&)`, keeping the existing
  templated renderer shape so both `M5Canvas` and `M5.Display` work.
- Add a small `drawProviderMark(G&, const char*, int, int)` helper that maps
  the fixed provider names to primitive glyphs.
- Update the header portion of `drawUI(G&)` to reserve space for and draw the
  provider mark before drawing `Win.n`.
- Keep `render()`, `handleLine()`, and the saver branches in `loop()` behaviorally
  identical apart from the new renderer name and comments.

No new `Win` field is needed. Provider identity is already carried in `Win.n`,
and the four fixed names are bounded by the existing `char n[12]` storage.

## Data Flow and Error Handling

The serial flow remains:

```text
Mac provider fetches -> normalized JSON frame -> USB serial -> Win.n -> renderer
```

The new artwork does not read percentages, reset timestamps, token state, or
provider error details. If a provider is degraded, its mark still renders
next to its name while the existing degraded UI communicates the failure. If
the frame has no valid windows, the existing `Waiting for Mac...` state remains
unchanged and no provider mark is drawn.

## Verification

Firmware has no unit-test harness. Verification is a PlatformIO compile plus
hardware observation:

- `cd firmware && pio run` succeeds with no unresolved drawing symbols.
- After 30 seconds idle, the crab is gone and the centered square OpenCode mark
  appears on the dark background.
- The mark floats smoothly without leaving trails or visible flicker.
- Any button wakes the usage page, with the waking press still consumed.
- Claude, Codex, Cursor, and Grok pages show the matching small provider mark.
- Provider error and stale states preserve the correct mark and existing error
  behavior.
- A frame received while the saver is active does not wake the device.
- `./pusher.sh` and the serial frame behavior require no changes.

If hardware is available, flash using the existing 460800 upload setting after
freeing the serial port with `./pusher.sh stop`, then restart the pusher with
`./pusher.sh start`.
