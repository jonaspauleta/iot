// Minimal USB-serial I/O for macOS without a native module. The `serialport`
// npm package crashes under Bun (libuv uv_default_loop unsupported, bun#18546),
// so we configure the line with stty and hold one non-blocking fd open: write
// frames with fs.writeSync, poll for incoming bytes with fs.readSync. Holding a
// single fd open means the ESP32 auto-resets only once (at open), never per write.
const fs = require('node:fs');

// List /dev/cu.usbserial* devices. cu. is the call-up device (does not block on
// carrier detect), preferred over tty. for talking to a USB-serial adapter.
function listPorts() {
  return fs
    .readdirSync('/dev')
    .filter((d) => /^(cu|tty)\.usbserial/i.test(d))
    .map((d) => '/dev/' + d);
}

function pickPort() {
  const ports = listPorts();
  if (!ports.length) return null;
  const cu = ports.find((p) => /\/cu\./.test(p));
  return cu || ports[0];
}

function open(path, baud) {
  const flags = fs.constants.O_RDWR | fs.constants.O_NOCTTY | fs.constants.O_NONBLOCK;
  const fd = fs.openSync(path, flags);
  // Configure the line AFTER opening. Opening a fresh fd leaves the USB-serial
  // driver at whatever rate it was last programmed to (e.g. 460800 from an
  // esptool firmware upload), so setting baud before the open does not stick.
  // stty -f can operate on the already-open port. raw mode, 8N1, ignore
  // modem-control lines, no echo, -hupcl so a later close keeps DTR.
  Bun.spawnSync([
    '/bin/stty', '-f', path, String(baud),
    'cs8', '-cstopb', '-parenb', 'raw', '-echo', 'clocal', '-hupcl',
  ]);
  return fd;
}

function write(fd, str) {
  fs.writeSync(fd, Buffer.from(str, 'utf8'));
}

// Non-blocking read: returns '' when no data is waiting (EAGAIN on the fd).
function read(fd) {
  const buf = Buffer.alloc(256);
  try {
    const n = fs.readSync(fd, buf, 0, buf.length, null);
    return n > 0 ? buf.subarray(0, n).toString('utf8') : '';
  } catch (e) {
    if (e && e.code === 'EAGAIN') return '';
    throw e;
  }
}

function close(fd) {
  try { fs.closeSync(fd); } catch {}
}

module.exports = { listPorts, pickPort, open, write, read, close };
