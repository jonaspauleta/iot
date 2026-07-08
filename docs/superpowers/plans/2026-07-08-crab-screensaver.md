# Crab Screensaver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After 30s without a button press, the M5Stack shows an animated procedural Clawd (Claude's crab); any button wakes back to the bars screen.

**Architecture:** All changes live in `firmware/src/main.cpp`. A `saverActive` flag switches `render()` between the existing `drawUI()` and a new `drawCrab()`; `loop()` tracks the last button press, consumes the waking press, and speeds the render tick from 1s to 66ms while the saver is active. Serial frames keep being parsed during the saver but do not render or wake.

**Tech Stack:** C++/Arduino on ESP32 via PlatformIO, M5Unified (M5GFX/LovyanGFX drawing primitives). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-08-crab-screensaver-design.md`

## Global Constraints

- Single file: all firmware changes go in `firmware/src/main.cpp`. No new files, no new libraries.
- Firmware has no test harness. The per-task check is `pio run` (compile). Hardware verification is its own final task.
- Flashing: upload baud is 460800 (already in `platformio.ini`, do not change). Before flashing run `./pusher.sh stop` from the repo root (frees the serial port), after flashing run `./pusher.sh start`.
- Do not run a serial monitor while the pusher agent is loaded; only one process may hold the port.
- `SAVER_MS = 30000` (30 seconds). Saver render tick = 66 ms (~15 fps). Blink: 150 ms closed every 3400 ms. Claw wave: 1000 ms every 7000 ms.
- Crab color is Claude coral `#D97757` = `color565(217, 119, 87)`; dark shade `color565(154, 78, 54)`.

---

### Task 1: Screensaver state machine (with stub crab)

**Files:**
- Modify: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: existing globals `useSprite`, `canvas`, `lineBuf`, `nWin`, `cur`, `refreshCueUntil`, `lastRender`, existing functions `drawUI()`, `handleLine()`.
- Produces: globals `SAVER_MS`, `lastBtnMillis`, `saverActive`; template function `drawCrab(G& g)` (stub for now, Task 2 fills the body). `render()` dispatches on `saverActive`.

- [ ] **Step 1: Add saver constants and state**

In `firmware/src/main.cpp`, after the line `static const uint32_t STALE_MS = 900000; // 15 min; > default 5 min poll` add:

```cpp
static const uint32_t SAVER_MS = 30000; // idle time before the crab takes over
```

After the line `bool haveData = false, beat = false;` add:

```cpp
uint32_t lastBtnMillis = 0;   // boot counts as a press: saver starts 30s after boot
bool saverActive = false;
```

- [ ] **Step 2: Add the stub drawCrab**

Immediately BEFORE the `void render()` function, add:

```cpp
// Screensaver: animated Clawd. Body filled in by Task 2; stub blanks the screen.
template <typename G>
void drawCrab(G& g) {
  g.fillRect(0, 0, W, H, C_BG);
}
```

- [ ] **Step 3: Dispatch render() on saverActive**

Replace the entire existing `render()` function:

```cpp
void render() {
  if (useSprite) {
    drawUI(canvas);
    canvas.pushSprite(0, 0);
  } else {
    drawUI(M5.Display);
  }
}
```

with:

```cpp
void render() {
  if (useSprite) {
    if (saverActive) drawCrab(canvas); else drawUI(canvas);
    canvas.pushSprite(0, 0);
  } else {
    if (saverActive) drawCrab(M5.Display); else drawUI(M5.Display);
  }
}
```

- [ ] **Step 4: Rework loop() for enter/wake/consume and the fast tick**

Replace the entire existing `loop()` function with:

```cpp
void loop() {
  M5.update();

  bool anyBtn = M5.BtnA.wasPressed() || M5.BtnB.wasPressed() || M5.BtnC.wasPressed();

  if (saverActive) {
    if (anyBtn) { // wake; the waking press is consumed (no nav, no REFRESH)
      saverActive = false;
      lastBtnMillis = millis();
      render();
    }
  } else {
    if (anyBtn) lastBtnMillis = millis();
    if (nWin > 0) {
      if (M5.BtnA.wasPressed()) { cur = (cur + nWin - 1) % nWin; render(); }
      if (M5.BtnC.wasPressed()) { cur = (cur + 1) % nWin; render(); }
    }
    if (M5.BtnB.wasPressed()) {
      Serial.print("REFRESH\n");
      refreshCueUntil = millis() + 900;
      render();
    }
    if (millis() - lastBtnMillis > SAVER_MS) saverActive = true;
  }

  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      // During the saver: parse silently, no render, no wake.
      if (lineBuf.length()) { handleLine(lineBuf); lineBuf = ""; if (!saverActive) render(); }
    } else if (c != '\r') {
      if (lineBuf.length() < 800) lineBuf += c;
      else lineBuf = ""; // overflow guard
    }
  }

  uint32_t tick = saverActive ? 66 : 1000; // ~15 fps for the crab, 1 Hz for bars
  if (millis() - lastRender > tick) { lastRender = millis(); render(); }
}
```

- [ ] **Step 5: Verify it compiles**

Run: `cd firmware && pio run`
Expected: `SUCCESS` (no warnings about drawCrab; it is instantiated via render()).

- [ ] **Step 6: Commit**

```bash
git add firmware/src/main.cpp
git commit -m "feat: screensaver state machine (30s idle, any button wakes)"
```

---

### Task 2: Draw the animated Clawd

**Files:**
- Modify: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: `drawCrab(G& g)` stub from Task 1, existing color globals `C_BG`, `C_TEXT`, the `W`/`H` constants, `setup()` color initialization block.
- Produces: globals `C_CRAB`, `C_CRAB_DK`; full `drawCrab()` body. No signature changes.

- [ ] **Step 1: Add crab colors**

In the global color declarations, change:

```cpp
uint16_t C_BG, C_TRACK, C_GREEN, C_AMBER, C_RED, C_TEXT, C_DIM, C_ACCENT;
```

to:

```cpp
uint16_t C_BG, C_TRACK, C_GREEN, C_AMBER, C_RED, C_TEXT, C_DIM, C_ACCENT;
uint16_t C_CRAB, C_CRAB_DK;
```

In `setup()`, after the line `C_ACCENT = M5.Display.color565(120, 170, 255);` add:

```cpp
C_CRAB = M5.Display.color565(217, 119, 87);   // Claude coral #D97757
C_CRAB_DK = M5.Display.color565(154, 78, 54);
```

- [ ] **Step 2: Replace the drawCrab stub with the animated scene**

Replace the whole stub `drawCrab` (from Task 1) with:

```cpp
// Screensaver: animated Clawd built from primitives. All coords hang off
// (cx, cy) so the sine bob moves the whole crab; timings per the spec:
// bob ~2.5s period, blink 150ms every 3.4s, left-claw wave 1s every 7s.
template <typename G>
void drawCrab(G& g) {
  g.fillRect(0, 0, W, H, C_BG);

  uint32_t t = millis();
  int cx = W / 2;
  int cy = H / 2 + 20 + (int)(sinf(t * 0.0025f) * 4.0f); // bob

  uint32_t wp = t % 7000; // left claw lifts for 1s every 7s
  int lift = wp < 1000 ? (int)(sinf(wp * (float)M_PI / 1000.0f) * 18.0f) : 0;

  // Legs (under the body), three per side, doubled lines for thickness.
  for (int i = 0; i < 3; i++) {
    int lx = 18 + i * 16;
    g.drawLine(cx - lx, cy + 36, cx - lx - 12, cy + 54, C_CRAB_DK);
    g.drawLine(cx - lx + 1, cy + 36, cx - lx - 11, cy + 54, C_CRAB_DK);
    g.drawLine(cx + lx, cy + 36, cx + lx + 12, cy + 54, C_CRAB_DK);
    g.drawLine(cx + lx - 1, cy + 36, cx + lx + 11, cy + 54, C_CRAB_DK);
  }

  // Arm joints + claws (drawn before the body so it covers the seams).
  g.fillCircle(cx - 66, cy - 2, 9, C_CRAB_DK);
  g.fillCircle(cx + 66, cy - 2, 9, C_CRAB_DK);
  int lcy = cy - 10 - lift;
  g.fillCircle(cx - 88, lcy, 20, C_CRAB);
  g.fillTriangle(cx - 88, lcy, cx - 112, lcy - 16, cx - 112, lcy + 4, C_BG); // pincer
  g.fillCircle(cx + 88, cy - 10, 20, C_CRAB);
  g.fillTriangle(cx + 88, cy - 10, cx + 112, cy - 26, cx + 112, cy - 6, C_BG);

  // Eye stalks (body covers their roots).
  g.fillRect(cx - 22 - 3, cy - 56, 6, 26, C_CRAB);
  g.fillRect(cx + 22 - 3, cy - 56, 6, 26, C_CRAB);

  // Body.
  g.fillEllipse(cx, cy, 62, 46, C_CRAB);

  // Eyes; blink = coral lid with a dark slit.
  bool closed = (t % 3400) < 150;
  for (int s = -1; s <= 1; s += 2) {
    int ex = cx + s * 22, ey = cy - 56;
    if (closed) {
      g.fillCircle(ex, ey, 9, C_CRAB);
      g.fillRect(ex - 7, ey - 1, 14, 3, C_CRAB_DK);
    } else {
      g.fillCircle(ex, ey, 9, C_TEXT);
      g.fillCircle(ex, ey + 2, 4, C_BG);
    }
  }

  // Smile (drawArc: 0 deg at 3 o'clock, clockwise; 30..150 is the bottom arc).
  g.drawArc(cx, cy - 6, 14, 16, 30, 150, C_CRAB_DK);
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd firmware && pio run`
Expected: `SUCCESS`.

- [ ] **Step 4: Commit**

```bash
git add firmware/src/main.cpp
git commit -m "feat: animated Clawd screensaver scene (bob, blink, claw wave)"
```

---

### Task 3: Flash and verify on hardware

**Files:**
- None modified; hardware verification only.

**Interfaces:**
- Consumes: the built firmware from Tasks 1-2, `./pusher.sh` (repo root).
- Produces: verified behavior on the device.

- [ ] **Step 1: Free the serial port**

Run from repo root: `./pusher.sh stop`
Expected: agent unloaded, port free.

- [ ] **Step 2: Flash**

Run: `cd firmware && pio run -t upload`
Expected: upload completes at 460800 baud, `SUCCESS`.

- [ ] **Step 3: Restart the pusher**

Run from repo root: `./pusher.sh start`
Expected: agent loaded; within ~5s the device shows provider bars again (resend feeds the cached frame after the flash reset).

- [ ] **Step 4: Verify saver behavior (human observation)**

- Wait 30s without touching buttons: crab appears, bobs, blinks every few seconds, left claw waves about every 7s. Animation is smooth (no flicker).
- Press any button: bars screen returns immediately; the press did NOT change the page or trigger a refresh (check no "refreshing" tag appears after waking with button B).
- Wait 30s again with the pusher running: crab returns; a poll arriving during the saver does not flip the screen back to bars.

Expected: all three observations hold. If flicker is visible, confirm the device is on the sprite path (it is on this unit; direct-draw fallback would flicker at 15 fps but that path only triggers if sprite allocation fails).

- [ ] **Step 5: Final commit if anything changed, then done**

No code changes expected in this task. If verification forced a tweak (e.g. animation timing), commit it:

```bash
git add firmware/src/main.cpp
git commit -m "fix: crab screensaver tuning after hardware verification"
```
