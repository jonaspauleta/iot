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
