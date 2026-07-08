// Decode (not verify) a JWT payload. base64url -> JSON. Throws on malformed input.
function decodeJwt(token) {
  const seg = String(token).split('.')[1];
  if (!seg) throw new Error('not a jwt');
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(pad, 'base64').toString('utf8'));
}

module.exports = { decodeJwt };
