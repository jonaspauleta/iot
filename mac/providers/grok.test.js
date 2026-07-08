const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseGrok } = require('./grok');

// --- minimal protobuf encoders (mirror ../lib/grpcweb.test.js) ---
function varint(n) {
  const out = [];
  let v = BigInt(n);
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  } while (v > 0n);
  return Buffer.from(out);
}
const tag = (field, wire) => varint((field << 3) | wire);
const varintField = (field, n) => Buffer.concat([tag(field, 0), varint(n)]);
function floatField(field, f) {
  const b = Buffer.alloc(4);
  b.writeFloatLE(f, 0);
  return Buffer.concat([tag(field, 5), b]);
}
const lenDelim = (field, payload) =>
  Buffer.concat([tag(field, 2), varint(payload.length), payload]);
function frame(flags, payload) {
  const head = Buffer.alloc(5);
  head[0] = flags;
  head.writeUInt32BE(payload.length, 1);
  return Buffer.concat([head, payload]);
}
const okTrailer = () => frame(0x80, Buffer.from('grpc-status:0\r\n'));

const FUTURE = 4070908800; // Jan 1 2099

// --- fixture 1: field 1 -> {5:{1:FUTURE}, 8:{1:1}}, no float ---
// Loaded from fixtures/grok-frame.b64 (built the same way, see /tmp/gen-fixture.js
// logic mirrored above) to exercise reading a recorded body, not just an inline one.
const fixturePath = path.join(__dirname, '../fixtures/grok-frame.b64');
const body1 = Buffer.from(fs.readFileSync(fixturePath, 'utf8').trim(), 'base64');

const parsed1 = parseGrok(body1);
assert.strictEqual(parsed1.ok, true, 'fixture 1 parses ok');
assert.strictEqual(parsed1.bars.length, 1, 'one bar');
assert.strictEqual(parsed1.bars[0].l, 'Credits');
assert.strictEqual(parsed1.bars[0].p, 0, 'no float + marker=1 + future reset -> p:0');
assert.strictEqual(parsed1.bars[0].r, FUTURE, 'reset read from [1,5,1]');

// --- fixture 2: field 1 -> {5:{1:FUTURE}, 8:{1:1}, 2:{1: float 42.0}} ---
const inner2 = Buffer.concat([
  lenDelim(5, varintField(1, FUTURE)),
  lenDelim(8, varintField(1, 1)),
  lenDelim(2, floatField(1, 42.0)),
]);
const message2 = lenDelim(1, inner2);
const body2 = Buffer.concat([frame(0x00, message2), okTrailer()]);

const parsed2 = parseGrok(body2);
assert.strictEqual(parsed2.ok, true, 'fixture 2 parses ok');
assert.strictEqual(parsed2.bars.length, 1, 'one bar');
assert.ok(Math.abs(parsed2.bars[0].p - 42) < 0.01, 'float usedPercent read as ~42');
assert.strictEqual(parsed2.bars[0].r, FUTURE, 'reset read from [1,5,1]');

// --- reauth: non-zero grpc-status trailer ---
const inner3 = lenDelim(5, varintField(1, FUTURE));
const message3 = lenDelim(1, inner3);
const body3 = Buffer.concat([
  frame(0x00, message3),
  frame(0x80, Buffer.from('grpc-status:16\r\n')),
]);
const parsed3 = parseGrok(body3);
assert.strictEqual(parsed3.ok, false);
assert.strictEqual(parsed3.e, 'reauth', 'non-zero grpc-status -> reauth');

// --- err: empty / undecodable buffer ---
const parsed4 = parseGrok(Buffer.alloc(0));
assert.strictEqual(parsed4.ok, false);
assert.strictEqual(parsed4.e, 'err', 'empty buffer -> err');

console.log('grok: all assertions passed');
