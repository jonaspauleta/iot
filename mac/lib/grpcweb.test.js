const assert = require('node:assert');
const { parseFrames, scanProtobuf, findField } = require('./grpcweb');

// --- minimal protobuf encoders (mirror the wire format the scanner reads) ---
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

// Build a message matching the observed GrokBuildBilling shape:
// field 1 -> { 4:{1:start}, 5:{1:end/reset}, 8:{1:marker}, 2:{1:float usedPercent} }
const START = 1751990400;
const END = 1752560000;
const inner = Buffer.concat([
  lenDelim(4, varintField(1, START)),
  lenDelim(5, varintField(1, END)),
  lenDelim(8, varintField(1, 1)),
  lenDelim(2, floatField(1, 37.5)),
]);
const message = lenDelim(1, inner);

// Wrap in a gRPC-web data frame + a trailer frame.
function frame(flags, payload) {
  const head = Buffer.alloc(5);
  head[0] = flags;
  head.writeUInt32BE(payload.length, 1);
  return Buffer.concat([head, payload]);
}
const body = Buffer.concat([
  frame(0x00, message),
  frame(0x80, Buffer.from('grpc-status:0\r\n')),
]);

const { data, trailers } = parseFrames(body);
assert.strictEqual(data.length, 1, 'one data frame');
assert.strictEqual(trailers.length, 1, 'one trailer frame');
assert.ok(trailers[0].includes('grpc-status:0'));

const fields = scanProtobuf(data[0]);
assert.strictEqual(findField(fields, [1, 5, 1]).value, BigInt(END), 'reset at [1,5,1]');
assert.strictEqual(findField(fields, [1, 8, 1]).value, 1n, 'marker at [1,8,1]');
const flt = findField(fields, [1, 2, 1]);
assert.strictEqual(flt.wire, 5);
assert.ok(Math.abs(flt.value - 37.5) < 0.01, 'float usedPercent decoded');

console.log('grpcweb: all assertions passed');
