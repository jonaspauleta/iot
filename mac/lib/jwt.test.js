const assert = require('node:assert');
const { decodeJwt } = require('./jwt');

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const token = `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'user|abc123', exp: 9999999999 })}.sig`;
const payload = decodeJwt(token);

assert.strictEqual(payload.sub, 'user|abc123');
assert.strictEqual(payload.exp, 9999999999);
assert.throws(() => decodeJwt('not-a-jwt'), /not a jwt/);

console.log('jwt: all assertions passed');
