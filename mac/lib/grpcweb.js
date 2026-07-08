// Minimal gRPC-web frame splitter + protobuf field scanner. Enough to read
// xAI's GrokBuildBilling response; not a general-purpose protobuf decoder.

// Split a gRPC-web body into data frames and trailer frames.
// Framing: [1 flags byte][4-byte BE length][payload]. flags & 0x80 == trailer.
function parseFrames(buf) {
  const data = [];
  const trailers = [];
  let o = 0;
  while (o + 5 <= buf.length) {
    const flags = buf[o];
    const len = buf.readUInt32BE(o + 1);
    const end = o + 5 + len;
    if (end > buf.length) break;
    const payload = buf.subarray(o + 5, end);
    o = end;
    if (flags & 0x80) trailers.push(payload.toString('utf8'));
    else data.push(payload);
  }
  return { data, trailers };
}

function readVarint(buf, o) {
  let shift = 0n;
  let result = 0n;
  while (o < buf.length) {
    const b = BigInt(buf[o++]);
    result |= (b & 0x7fn) << shift;
    if (!(b & 0x80n)) break;
    shift += 7n;
  }
  return [result, o];
}

// A length-delimited chunk is treated as a sub-message only if its first tag
// decodes to a sane wire type; otherwise it is a leaf (string/bytes).
function looksLikeMessage(buf) {
  if (buf.length === 0) return false;
  const [key, k1] = readVarint(buf, 0);
  if (k1 > buf.length) return false;
  const wire = Number(key & 7n);
  return wire <= 5 && wire !== 3 && wire !== 4;
}

// Walk a protobuf message into a flat list of leaf fields tagged with their path.
// wire 0 varint, 1 fixed64(double), 2 length-delim (recurse), 5 fixed32(float).
function scanProtobuf(buf, path = [], out = [], depth = 0) {
  let o = 0;
  while (o < buf.length) {
    const [key, k1] = readVarint(buf, o);
    if (k1 > buf.length) break;
    o = k1;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    const p = path.concat(field);
    if (wire === 0) {
      const [v, n] = readVarint(buf, o);
      o = n;
      out.push({ path: p, wire, value: v });
    } else if (wire === 5) {
      if (o + 4 > buf.length) break;
      out.push({ path: p, wire, value: buf.readFloatLE(o) });
      o += 4;
    } else if (wire === 1) {
      if (o + 8 > buf.length) break;
      out.push({ path: p, wire, value: buf.readDoubleLE(o) });
      o += 8;
    } else if (wire === 2) {
      const [len, n] = readVarint(buf, o);
      o = n;
      const sub = buf.subarray(o, o + Number(len));
      o += Number(len);
      if (depth < 5 && looksLikeMessage(sub)) scanProtobuf(sub, p, out, depth + 1);
      else out.push({ path: p, wire, value: sub.length });
    } else {
      break;
    }
  }
  return out;
}

function findField(fields, path) {
  return fields.find(
    (f) => f.path.length === path.length && f.path.every((x, i) => x === path[i])
  );
}

module.exports = { parseFrames, scanProtobuf, findField, readVarint };
