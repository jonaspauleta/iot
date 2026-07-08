#!/usr/bin/env node
// Poll `claude -p "/usage"`, parse, and push one JSON frame per poll to the
// M5Stack over USB serial. The device is a pure display.

const os = require('node:os');
const { execFile } = require('node:child_process');
const { SerialPort } = require('serialport');
const { parse } = require('./usage-parser');

const POLL_MS = Number(process.env.POLL_MS || 90000);
const CLAUDE_CWD = process.env.CLAUDE_CWD || os.homedir();
const PORT_PATH = process.env.PORT || null;
const MODE = process.argv[2] || '';

function toFrame(p) {
  if (!p.ok) return { ok: 0 };
  return {
    s: { p: p.session.pct, r: p.session.reset },
    w: { p: p.week.pct, r: p.week.reset },
    f: { p: p.fable.pct, r: p.fable.reset },
    ok: 1,
  };
}

function getUsage() {
  return new Promise((resolve) => {
    execFile(
      'claude',
      ['-p', '/usage'],
      { cwd: CLAUDE_CWD, timeout: 20000, maxBuffer: 1 << 20 },
      (err, stdout) => resolve(err ? { ok: false } : parse(stdout))
    );
  });
}

async function findPort() {
  if (PORT_PATH) return PORT_PATH;
  const ports = await SerialPort.list();
  const m = ports.find(
    (p) => /usbserial/i.test(p.path) || /usbserial/i.test(p.pnpId || '')
  );
  return m ? m.path : null;
}

// Open the port once and hold it open. Reopening every poll would reset the
// ESP32 every poll, so we keep a single handle and reconnect only on error.
let port = null;
let opening = false;

async function ensurePort() {
  if (port && port.isOpen) return port;
  if (opening) return null;
  opening = true;
  try {
    const path = await findPort();
    if (!path) {
      console.error('no usbserial port found');
      return null;
    }
    port = new SerialPort({ path, baudRate: 115200, autoOpen: false });
    await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res())));
    port.on('error', (e) => {
      console.error('serial error:', e.message);
      try { port.close(); } catch {}
      port = null;
    });
    port.on('close', () => { port = null; });
    console.error('serial open:', path);
    // The open above resets the ESP32 once; give it time to boot before writing.
    await new Promise((r) => setTimeout(r, 2500));
    return port;
  } catch (e) {
    console.error('open failed:', e.message);
    port = null;
    return null;
  } finally {
    opening = false;
  }
}

function writeFrame(frame) {
  if (!port || !port.isOpen) return;
  port.write(JSON.stringify(frame) + '\n', (err) => {
    if (err) console.error('write error:', err.message);
  });
}

async function tick() {
  const frame = toFrame(await getUsage());
  if (MODE === '--stdout') {
    console.log(JSON.stringify(frame));
    return;
  }
  await ensurePort();
  writeFrame(frame);
  console.error(
    new Date().toISOString(),
    frame.ok ? `s${frame.s.p} w${frame.w.p} f${frame.f.p}` : 'ok:0'
  );
}

async function replay() {
  const frames = [
    { s: { p: 0, r: '6:19pm' }, w: { p: 12, r: 'Jul 10 3am' }, f: { p: 5, r: 'Jul 10 3am' }, ok: 1 },
    { s: { p: 5, r: '6:19pm' }, w: { p: 59, r: 'Jul 10 3am' }, f: { p: 82, r: 'Jul 10 3am' }, ok: 1 },
    { s: { p: 97, r: '6:19pm' }, w: { p: 88, r: 'Jul 10 3am' }, f: { p: 100, r: 'Jul 10 3am' }, ok: 1 },
    { ok: 0 },
  ];
  await ensurePort();
  let i = 0;
  setInterval(() => {
    const f = frames[i % frames.length];
    console.error('replay', JSON.stringify(f));
    writeFrame(f);
    i++;
  }, 3000);
}

async function main() {
  if (MODE === '--replay') return replay();
  if (MODE === '--stdout') {
    await tick();
    process.exit(0);
  }
  await tick(); // immediate first frame
  setInterval(tick, POLL_MS);
}

if (require.main === module) main();

module.exports = { toFrame };
