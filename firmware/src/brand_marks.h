#ifndef BRAND_MARKS_H
#define BRAND_MARKS_H

#include <stdint.h>

struct BrandMask {
  const uint16_t* rows;
  uint8_t width;
  uint8_t height;
};

template <typename G>
void drawBrandMask(G& g, const BrandMask& mark, int x, int y, uint16_t color) {
  for (uint8_t row = 0; row < mark.height; row++) {
    for (uint8_t col = 0; col < mark.width; col++) {
      if (mark.rows[row] & (uint16_t(1) << col)) {
        g.drawPixel(x + col, y + row, color);
      }
    }
  }
}

static const uint16_t CLAUDE_ROWS[16] = {
  0x0230, 0x0330, 0x3330, 0x3b66,
  0x1f7e, 0x0ff8, 0xcff0, 0x7fef,
  0x0fff, 0xffe0, 0x0ff8, 0x1f6c,
  0x3da0, 0x0db0, 0x1990, 0x0080,
};

static const uint16_t CODEX_ROWS[16] = {
  0x01c0, 0x0fb0, 0x3f18, 0x20dc,
  0x4e6e, 0x79ab, 0x776b, 0x4c2b,
  0xd032, 0xd2ee, 0x519e, 0x7272,
  0x3b84, 0x18fc, 0x0ff0, 0x0380,
};

static const uint16_t CURSOR_ROWS[16] = {
  0x0380, 0x07e0, 0x1ff8, 0x7ffc,
  0x4006, 0x600e, 0x603e, 0x70fe,
  0x70fe, 0x78fe, 0x78fe, 0x7cfe,
  0x3efe, 0x1ef8, 0x07e0, 0x01c0,
};

static const uint16_t GROK_ROWS[16] = {
  0x0000, 0x4000, 0x6fe0, 0x37f0,
  0x3838, 0x3c18, 0x360c, 0x330c,
  0x300c, 0x300c, 0x3818, 0x1c18,
  0x0fe4, 0x03c2, 0x0000, 0x0000,
};

static const BrandMask BRAND_CLAUDE = { CLAUDE_ROWS, 16, 16 };
static const BrandMask BRAND_CODEX = { CODEX_ROWS, 16, 16 };
static const BrandMask BRAND_CURSOR = { CURSOR_ROWS, 16, 16 };
static const BrandMask BRAND_GROK = { GROK_ROWS, 16, 16 };

#endif
