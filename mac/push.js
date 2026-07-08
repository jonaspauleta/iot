#!/usr/bin/env bun
// Poll four provider usage sources, normalize to one multi-window JSON frame per
// poll, and push it to the M5Stack over USB serial. The device is a pure display.
// It can send "REFRESH" back (middle button) to trigger an immediate re-poll.

const serial = require('./lib/serial');
const { buildFrame } = require('./frame');
const { fetchClaude } = require('./providers/claude');
const { fetchCodex } = require('./providers/codex');
const { fetchCursor } = require('./providers/cursor');
const { fetchGrok } = require('./providers/grok');

const POLL_MS = Number(process.env.POLL_MS || 300000);
const PORT_PATH = process.env.PORT || null;
const MODE = process.argv[2] || '';

async function gather() {
  // Each fetch<P> never throws; a failed provider comes back as a degraded window.
  const wins = await Promise.all([
    fetchClaude(),
    fetchCodex(),
    fetchCursor(),
    fetchGrok(),
  ]);
  return buildFrame(wins, Date.now() / 1000);
}

function summarize(frame) {
  return frame.w
    .map((w) => `${w.n} ${w.ok ? w.b.map((b) => b.p).join('/') : w.e || 'off'}`)
    .join('  ');
}

// Open the port once and hold it open (reopening every poll would reset the
// ESP32 every poll). Reconnect only on I/O error.
let fd = null;
let opening = false;
let rxBuf = '';
let lastRefresh = 0;
let lastFrame = null; // most recent frame, resent frequently so a device reboot self-heals

function ensurePort() {
  if (fd != null) return true;
  if (opening) return false;
  opening = true;
  try {
    const path = PORT_PATH || serial.pickPort();
    if (!path) {
      console.error('no usbserial port found');
      return false;
    }
    fd = serial.open(path, 115200);
    console.error('serial open:', path);
    return true;
  } catch (e) {
    console.error('open failed:', e.message);
    fd = null;
    return false;
  } finally {
    opening = false;
  }
}

function dropPort() {
  if (fd != null) { serial.close(fd); fd = null; }
}

function writeLine(line) {
  if (fd == null) return;
  try {
    serial.write(fd, line + '\n');
  } catch (e) {
    console.error('write error:', e.message);
    dropPort();
  }
}

// The device prints boot chatter and, on the middle button, "REFRESH". Poll the
// incoming stream for that token and trigger an immediate poll (debounced).
function pollDevice() {
  if (fd == null) return;
  let chunk;
  try {
    chunk = serial.read(fd);
  } catch (e) {
    console.error('read error:', e.message);
    dropPort();
    return;
  }
  if (!chunk) return;
  rxBuf = (rxBuf + chunk).slice(-64);
  if (rxBuf.includes('REFRESH')) {
    rxBuf = '';
    const now = Date.now();
    if (now - lastRefresh > 1000) {
      lastRefresh = now;
      console.error('device requested refresh');
      tick();
    }
  }
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const frame = await gather();
    if (MODE === '--stdout') {
      console.log(JSON.stringify(frame));
      return;
    }
    lastFrame = frame;
    ensurePort();
    writeLine(JSON.stringify(frame));
    console.error(new Date().toISOString(), summarize(frame));
  } finally {
    ticking = false;
  }
}

// Resend the cached frame on a short timer so the device shows data within a few
// seconds even after the open-time reset (opening the port resets the ESP32, and
// the boot would otherwise miss the first frame). Bump ts each time so on-device
// reset countdowns keep advancing between real fetches.
function resend() {
  if (!lastFrame) return;
  if (!ensurePort()) return;
  lastFrame.ts = Math.floor(Date.now() / 1000);
  writeLine(JSON.stringify(lastFrame));
}

async function replay() {
  const now = Math.floor(Date.now() / 1000);
  const H = 3600, D = 86400;
  const frames = [
    { v: 1, w: [
      { n: 'Claude', ok: 1, b: [ { l: '5h', p: 8, r: now + 2 * H }, { l: '7d', p: 44, r: now + 2 * D }, { l: 'Fable', p: 12, r: now + 2 * D } ] },
      { n: 'Codex', ok: 1, b: [ { l: '5h', p: 30, r: now + H }, { l: '7d', p: 61, r: now + 3 * D } ] },
      { n: 'Cursor', ok: 1, b: [ { l: 'Total', p: 73, r: now + 20 * D }, { l: 'Auto', p: 66, r: now + 20 * D }, { l: 'API', p: 9, r: now + 20 * D } ] },
      { n: 'Grok', ok: 1, b: [ { l: 'Credits', p: 88, r: now + 4 * D } ] },
    ] },
    { v: 1, w: [
      { n: 'Claude', ok: 1, b: [ { l: '5h', p: 97, r: now + 20 * 60 }, { l: '7d', p: 82, r: now + D }, { l: 'Fable', p: 100, r: now + D } ] },
      { n: 'Codex', ok: 0, e: 'reauth', b: [] },
      { n: 'Cursor', ok: 1, b: [ { l: 'Total', p: 51, r: now + 10 * D }, { l: 'Auto', p: 40, r: now + 10 * D }, { l: 'API', p: -1, r: 0 } ] },
      { n: 'Grok', ok: 0, e: 'stale', b: [ { l: 'Credits', p: 5, r: now + D } ] },
    ] },
  ];
  ensurePort();
  let i = 0;
  setInterval(() => {
    const f = { ...frames[i % frames.length], ts: Math.floor(Date.now() / 1000) };
    console.error('replay', summarize(f));
    writeLine(JSON.stringify(f));
    i++;
  }, 3000);
}

async function main() {
  if (MODE === '--replay') {
    await replay();
  } else if (MODE === '--stdout') {
    await tick();
    process.exit(0);
  } else {
    await tick(); // immediate first fetch
    setInterval(tick, POLL_MS);
    setInterval(resend, 3000); // keep the device fed + countdowns fresh
  }
  if (MODE !== '--stdout') setInterval(pollDevice, 200);
}

if (import.meta.main) main();

module.exports = { gather, summarize };
