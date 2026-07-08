#include <M5Unified.h>
#include <ArduinoJson.h>

// Multi-provider usage display. The Mac pushes one JSON frame per poll carrying
// up to four provider "windows"; we page between them with the buttons and render
// each provider's bars. Reset countdowns are extrapolated from the frame's `ts`
// plus millis(), so the device needs no clock of its own.

static const int W = 320, H = 240;
static const int BAR_X = 12, BAR_W = 296, BAR_H = 16;
static const int REGION_Y0 = 42, REGION_Y1 = 224;
static const int MAX_WIN = 4, MAX_BAR = 3;
static const uint32_t STALE_MS = 900000; // 15 min; > default 5 min poll
static const uint32_t SAVER_MS = 30000; // idle time before the crab takes over

uint16_t C_BG, C_TRACK, C_GREEN, C_AMBER, C_RED, C_TEXT, C_DIM, C_ACCENT;
uint16_t C_CRAB;

M5Canvas canvas(&M5.Display);
bool useSprite = false;

struct Bar { int p; uint32_t r; char l[10]; };
struct Win {
  char n[12];
  bool ok;
  char e[8];
  Bar bar[MAX_BAR];
  int nbar;
  bool haveGood;
};

Win win[MAX_WIN];
int nWin = 0;
int cur = 0;
uint32_t frameTs = 0, rxMillis = 0, lastRender = 0, refreshCueUntil = 0;
bool haveData = false, beat = false;
uint32_t lastBtnMillis = 0;   // boot counts as a press: saver starts 30s after boot
bool saverActive = false;
String lineBuf;

uint16_t barColor(int p) {
  if (p < 0) return C_TRACK;
  if (p >= 80) return C_RED;
  if (p >= 50) return C_AMBER;
  return C_GREEN;
}

uint32_t nowSec() {
  return frameTs + (millis() - rxMillis) / 1000;
}

void fmtRel(uint32_t r, char* out, size_t n) {
  if (r == 0) { strlcpy(out, "--", n); return; }
  uint32_t now = nowSec();
  if (r <= now) { strlcpy(out, "now", n); return; }
  uint32_t s = r - now;
  uint32_t d = s / 86400; s %= 86400;
  uint32_t h = s / 3600; s %= 3600;
  uint32_t m = s / 60;
  if (d >= 1) snprintf(out, n, "%lud %luh", (unsigned long)d, (unsigned long)h);
  else if (h >= 1) snprintf(out, n, "%luh %lum", (unsigned long)h, (unsigned long)m);
  else snprintf(out, n, "%lum", (unsigned long)m);
}

template <typename G>
void drawBlock(G& g, int top, int blockH, const Bar& b, bool dim) {
  int cy = top + (blockH - 52) / 2;
  g.setFont(&fonts::FreeSansBold9pt7b);
  g.setTextColor(dim ? C_DIM : C_TEXT);
  g.setTextDatum(TL_DATUM);
  g.drawString(b.l, BAR_X, cy);

  char pctStr[8];
  if (b.p < 0) snprintf(pctStr, sizeof(pctStr), "--");
  else snprintf(pctStr, sizeof(pctStr), "%d%%", b.p);
  g.setTextDatum(TR_DATUM);
  g.drawString(pctStr, BAR_X + BAR_W, cy);

  int by = cy + 20;
  g.fillRoundRect(BAR_X, by, BAR_W, BAR_H, 4, C_TRACK);
  int p = b.p < 0 ? 0 : (b.p > 100 ? 100 : b.p);
  int fw = (int)((long)BAR_W * p / 100);
  if (fw > 0) g.fillRoundRect(BAR_X, by, fw, BAR_H, 4, dim ? C_DIM : barColor(b.p));

  char rel[16];
  fmtRel(b.r, rel, sizeof(rel));
  char rl[24];
  snprintf(rl, sizeof(rl), "resets %s", rel);
  g.setFont(&fonts::FreeSans9pt7b);
  g.setTextColor(C_DIM);
  g.setTextDatum(TL_DATUM);
  g.drawString(rl, BAR_X, by + BAR_H + 4);
}

template <typename G>
void drawUI(G& g) {
  g.fillRect(0, 0, W, H, C_BG);

  if (!haveData) {
    g.setFont(&fonts::FreeSans12pt7b);
    g.setTextColor(C_DIM);
    g.setTextDatum(MC_DATUM);
    g.drawString("Waiting for Mac...", W / 2, H / 2);
    return;
  }

  const Win& w = win[cur];

  // Header: provider name, degraded tag, heartbeat.
  g.setFont(&fonts::FreeSansBold12pt7b);
  g.setTextColor(C_TEXT);
  g.setTextDatum(TL_DATUM);
  g.drawString(w.n, BAR_X, 6);

  g.fillCircle(W - 14, 14, 4, beat ? C_GREEN : C_TRACK);

  bool stale = millis() - rxMillis > STALE_MS;
  if (!w.ok || stale) {
    const char* tag = stale ? "stale" : (w.e[0] ? w.e : "err");
    g.setFont(&fonts::FreeSans9pt7b);
    g.setTextColor(strcmp(tag, "stale") == 0 ? C_AMBER : C_RED);
    g.setTextDatum(TR_DATUM);
    g.drawString(tag, W - 26, 10);
  }
  if (millis() < refreshCueUntil) {
    g.setFont(&fonts::FreeSans9pt7b);
    g.setTextColor(C_ACCENT);
    g.setTextDatum(TR_DATUM);
    g.drawString("refreshing", W - 26, 10);
  }

  // Index dots.
  int dotSpace = 14, dotY = 32;
  int startX = W / 2 - ((nWin - 1) * dotSpace) / 2;
  for (int i = 0; i < nWin; i++) {
    g.fillCircle(startX + i * dotSpace, dotY, 3, i == cur ? C_ACCENT : C_TRACK);
  }

  bool dim = !w.ok || stale;

  if (w.nbar == 0) {
    const char* msg = "No data yet";
    if (w.e[0]) {
      if (strcmp(w.e, "reauth") == 0) msg = "Run its CLI to log in";
      else if (strcmp(w.e, "stale") == 0) msg = "Stale, run its CLI";
      else msg = "Fetch error";
    }
    g.setFont(&fonts::FreeSans12pt7b);
    g.setTextColor(C_DIM);
    g.setTextDatum(MC_DATUM);
    g.drawString(msg, W / 2, (REGION_Y0 + REGION_Y1) / 2);
  } else {
    int regionH = REGION_Y1 - REGION_Y0;
    int blockH = regionH / w.nbar;
    for (int i = 0; i < w.nbar; i++) {
      drawBlock(g, REGION_Y0 + i * blockH, blockH, w.bar[i], dim);
    }
  }

  // Button hint.
  g.setFont(&fonts::FreeSans9pt7b);
  g.setTextColor(C_TRACK);
  g.setTextDatum(BC_DATUM);
  g.drawString("< prev      refresh      next >", W / 2, H - 2);
}

// Screensaver: Clawd, the Claude Code mascot, drawn as a scaled pixel grid.
// o = body, # = eye, . = empty. Bob ~2.5s, blink 150ms every 3.4s, the left
// side stub wiggles for 1s every 7s.
static const char* CLAWD[] = {
  "..oooooooooo..",
  ".oooooooooooo.",
  ".oooooooooooo.",
  ".ooo#oooo#ooo.",
  ".ooo#oooo#ooo.",
  "oooooooooooooo",
  "oooooooooooooo",
  ".oooooooooooo.",
  "..oooooooooo..",
  "..o..o..o..o..",
};
static const int CROWS = 10, CCOLS = 14, CELL = 14;

template <typename G>
void drawCrab(G& g) {
  g.fillRect(0, 0, W, H, C_BG);

  uint32_t t = millis();
  int x0 = (W - CCOLS * CELL) / 2;
  int y0 = (H - CROWS * CELL) / 2 + (int)(sinf(t * 0.0025f) * 4.0f); // bob

  uint32_t wp = t % 7000;
  int lift = wp < 1000 ? (int)(sinf(wp * (float)M_PI / 1000.0f) * 8.0f) : 0;
  bool closed = (t % 3400) < 150;

  for (int r = 0; r < CROWS; r++) {
    for (int c = 0; c < CCOLS; c++) {
      char ch = CLAWD[r][c];
      if (ch == '.') continue;
      int x = x0 + c * CELL;
      int y = y0 + r * CELL - (c == 0 ? lift : 0); // wiggle the left stub column
      bool eye = ch == '#' && !closed;
      g.fillRect(x, y, CELL, CELL, eye ? C_BG : C_CRAB);
    }
  }
  if (closed) { // lids: a dark slit across the bottom of each eye
    int ey = y0 + 5 * CELL - 4;
    g.fillRect(x0 + 4 * CELL, ey, CELL, 4, C_BG);
    g.fillRect(x0 + 9 * CELL, ey, CELL, 4, C_BG);
  }
}

void render() {
  if (useSprite) {
    if (saverActive) drawCrab(canvas); else drawUI(canvas);
    canvas.pushSprite(0, 0);
  } else {
    if (saverActive) drawCrab(M5.Display); else drawUI(M5.Display);
  }
}

void handleLine(const String& line) {
  JsonDocument doc;
  if (deserializeJson(doc, line)) return; // ignore non-JSON (boot chatter)
  JsonArray w = doc["w"].as<JsonArray>();
  if (w.isNull()) return; // not our frame
  frameTs = doc["ts"] | 0;
  rxMillis = millis();
  beat = !beat;

  int i = 0;
  for (JsonObject wo : w) {
    if (i >= MAX_WIN) break;
    Win& d = win[i];
    strlcpy(d.n, wo["n"] | "", sizeof(d.n));
    d.ok = (wo["ok"] | 0) == 1;
    strlcpy(d.e, wo["e"] | "", sizeof(d.e));
    JsonArray b = wo["b"].as<JsonArray>();
    if (!b.isNull() && b.size() > 0) {
      int j = 0;
      for (JsonObject bo : b) {
        if (j >= MAX_BAR) break;
        d.bar[j].p = bo["p"] | 0;
        d.bar[j].r = (uint32_t)(bo["r"] | 0);
        strlcpy(d.bar[j].l, bo["l"] | "", sizeof(d.bar[j].l));
        j++;
      }
      d.nbar = j;
      d.haveGood = true;
    }
    // else keep previous bars (last-good); only ok/e were refreshed.
    i++;
  }
  nWin = i;
  if (cur >= nWin) cur = 0;
  haveData = true;
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(255);
  Serial.begin(115200);

  C_BG = M5.Display.color565(10, 10, 14);
  C_TRACK = M5.Display.color565(48, 48, 60);
  C_GREEN = M5.Display.color565(61, 220, 132);
  C_AMBER = M5.Display.color565(240, 185, 70);
  C_RED = M5.Display.color565(240, 85, 85);
  C_TEXT = M5.Display.color565(235, 235, 240);
  C_DIM = M5.Display.color565(140, 140, 155);
  C_ACCENT = M5.Display.color565(120, 170, 255);
  C_CRAB = M5.Display.color565(217, 119, 87);   // Claude coral #D97757

  // 8-bit sprite (75KB) fits internal RAM; the 16-bit one (150KB) does not on the
  // PSRAM-less Core. Fall back to direct draw if even this fails.
  canvas.setColorDepth(8);
  useSprite = (canvas.createSprite(W, H) != nullptr);

  render();
}

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
