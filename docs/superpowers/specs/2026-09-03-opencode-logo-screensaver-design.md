# OpenCode Screensaver and First-Party Provider Marks

Date: 2026-09-03
Status: Approved

## Summary

Replace the idle Clawd scene on the M5Stack with the official OpenCode square
mark using option A: a restrained vertical float. Replace the invented provider
glyphs with small monochrome renderings derived from first-party brand assets.
Update the Cursor window to show the three requested usage sources:
`1st party models`, `3rd party models`, and `grok bot`.

The Mac still fetches and normalizes data, and the device remains a pure
renderer. The existing serial frame shape stays unchanged.

## Decision

Option A is approved for the screensaver:

- Use the official OpenCode square mark, not a 7x7 approximation.
- Center it on the 320x240 display at approximately 96x120 pixels.
- Float it vertically by 3 pixels in each direction over a 4.8-second cycle.
- Clear the complete screen behind it. Do not show the provider header, page
  dots, status, button hint, or any other text while the saver is active.

The mark itself does not change shape, rotate, blink, pulse, or react to usage.

## Goals

- Make the idle screen immediately recognizable as OpenCode.
- Use faithful first-party geometry for Claude, Codex, Cursor, and Grok.
- Keep every provider mark legible at the M5Stack LCD's native resolution.
- Show Cursor's three usage sources with their exact requested labels.
- Preserve saver timing, button behavior, paging, refresh behavior, stale-state
  handling, and serial parsing.
- Keep provider authentication and network access on the Mac.

## Non-goals

- No new runtime dependencies or network access from the firmware.
- No changes to the serial protocol or top-level frame schema.
- No changes to the 30-second saver threshold or the approximately 15 fps saver
  tick.
- No usage-reactive animation, burn-in mitigation, or brightness changes.
- No invented X, C, chevron, or other substitute geometry when a source mark is
  available.
- No source ZIPs or large bitmap assets committed to the repository.

## Source Assets

The source files are references for the implementation and are not copied into
the repository:

- OpenCode square mark: `https://opencode.ai/brand`, dark square SVG.
- Claude Code Spark: `https://code.claude.com/docs/en/vs-code`, Spark SVG.
- OpenAI Blossom for Codex: `https://openai.com/brand/`, official Blossom path.
- Cursor cube: `~/Downloads/cursor-brand-assets.zip`,
  `General Logos/Cube/SVG/CUBE_2D_LIGHT.svg`.
- Grok logomark: `~/Downloads/SpaceXAI_Grok_Assets.zip`,
  `SpaceXAI_Grok_Assets/Grok_Logomark_Light.svg`.

The provider marks are monochrome source shapes tinted with the existing device
palette. The implementation stores only small 1-bit compile-time masks for the
four 16x16 header marks. No source asset is loaded at runtime, and the masks do
not contain provider data or credentials.

## Behavior

### Screensaver Entry and Exit

The existing state machine remains unchanged:

- The saver begins after `SAVER_MS` (30 seconds) without a button press.
- Any button wakes the usage screen, and the waking press is consumed.
- Serial frames continue to be parsed while the saver is active but do not wake
  it or force a usage-screen render.
- Boot still counts as the initial button timestamp.
- The saver renders at approximately 15 fps. Usage pages render at
  approximately 1 Hz.

### Idle Scene

`drawCrab()` is replaced by `drawOpenCodeMark()` in the existing render dispatch.
The renderer draws the official square silhouette from a small set of filled
rectangles:

- The outer light shape is a 96x120 vertical rectangle centered on the LCD.
- The official inner opening is cut out using the screen background color.
- The mark moves vertically by at most 3 pixels using a sine phase derived from
  `millis()`.
- The sprite and direct-draw paths produce the same scene.
- The scene contains no text, provider name, status indicator, page dots, or
  button hint.

### Provider Header Marks

The current provider name remains the source of truth. The header draws a
16x16 monochrome mark before `Win.n`, with a small gap before the name:

- Claude uses the Claude Code Spark mask in coral.
- Codex uses the OpenAI Blossom mask in mint.
- Cursor uses the official 2D cube mask in a light neutral color.
- Grok uses the official xAI Grok logomark mask in blue.
- An unexpected provider name uses the existing neutral fallback square.

The heartbeat, degraded tag, refresh cue, index dots, bar positions, and button
hint keep their current right-side or vertical positions. Degraded and stale
states continue to dim the bars and show their existing status tags; the mark
still identifies the provider.

## Cursor Data

`fetchCursor()` keeps its current Keychain JWT, WorkOS cookie derivation, token
expiry checks, and primary usage request:

- `GET https://cursor.com/api/usage-summary` supplies the core plan data.
- `1st party models` maps to `individualUsage.plan.autoPercentUsed`.
- `3rd party models` maps to `individualUsage.plan.apiPercentUsed`.
- Both core bars reset at `billingCycleEnd`.

After the core request succeeds, the provider performs the optional request:

- `POST https://cursor.com/api/dashboard/get-sand-usage-status`.
- It uses the same `WorkosCursorSessionToken` cookie and JSON `Accept` header.
- `grok bot` maps to `usagePercent`.
- Its reset maps from `nextResetTimestampUtc` with `toUnixSeconds()`.

The optional Bot request must not turn a valid core response into a provider
failure. If the request fails, returns a non-OK response, or lacks valid usage
fields, the `grok bot` bar is `{ p: -1, r: 0 }` while the two core bars remain
usable. A Bot authorization failure is also treated as an unknown optional bar,
not as a full Cursor reauthentication failure. Core authorization failures keep
the existing `reauth` behavior.

`parseCursor(json)` remains pure and returns exactly three bars with the labels
above. Its third bar is unknown because the core response does not contain Bot
data. A separate pure `parseCursorBot(json)` handles the optional response, and
`fetchCursor()` replaces that third bar when the optional request is valid.
`frame.js` continues to round and clamp percentages and serialize the same
`{ n, ok, b }` window shape.

## Architecture

### Firmware

Add `firmware/src/brand_marks.h` for the small compile-time masks and their
templated pixel-mask renderer. `firmware/src/main.cpp` remains responsible for
provider-name mapping, screen layout, the OpenCode screensaver geometry, and
state-machine behavior.

The firmware changes are:

- Increase `Bar.l` from `char l[10]` to `char l[17]`, including the null byte
  for the 16-character Cursor labels.
- Include `brand_marks.h` and map the four fixed provider names to masks.
- Replace the existing procedural provider glyphs with the source-derived masks.
- Replace the 7x7 screensaver grid with the official OpenCode silhouette and
  option-A float.
- Keep `render()`, `handleLine()`, button branches, serial handling, sprite
  allocation, and direct-draw fallback behaviorally unchanged.

### Mac

Update `mac/providers/cursor.js` with the pure Bot parser and optional request.
Update its co-located tests and fixtures. No credentials are written, logged,
or sent to the optional endpoint beyond the existing session cookie.

## Data Flow and Error Handling

```text
Cursor core request -> core parser
                   -> optional Bot request -> Bot parser
                   -> three normalized bars -> frame.js -> USB serial
                   -> Win.bar[] -> LCD renderer
```

The frame schema remains version 1. Unknown Bot data is represented by the
existing unknown-bar convention, `p: -1` and `r: 0`. If a complete provider
request fails, the existing degraded window, last-good bars, error tag, and
stale behavior remain in effect. If a provider name is unknown, its neutral
fallback mark prevents stale branding from being shown.

## Verification

### Mac Tests

- `bun run test` passes.
- Modern Cursor fixtures produce exactly three bars with the exact new labels.
- Legacy core data produces unknown values for missing first-party and
  third-party percentages.
- A valid Bot fixture parses `usagePercent` and
  `nextResetTimestampUtc` correctly.
- Missing, malformed, and failed Bot data leaves only the Bot bar unknown.
- Existing frame and provider collection tests remain unchanged in behavior.

### Firmware Build

- `cd firmware && pio run` succeeds.
- `Bar.l` accepts both 16-character Cursor labels without truncation.
- Both sprite and direct-draw render paths compile with the new mark helper.

### Hardware

After stopping the pusher and flashing at the existing 460800 upload speed:

- After 30 seconds idle, the crab is gone and the centered official OpenCode
  mark floats subtly on the empty dark screen.
- Any button wakes the usage page and consumes the waking press.
- Claude, Codex, Cursor, and Grok show their matching source-derived marks.
- Cursor shows `1st party models`, `3rd party models`, and `grok bot` without
  clipping.
- A missing Bot response leaves its bar as `--` while the other Cursor bars
  remain live.
- Paging, refresh, serial-fed frames while idle, stale tags, and degraded
  rendering retain their existing behavior.

If hardware is unavailable, report the Mac tests and firmware build as verified
and leave physical observations explicitly unverified.
