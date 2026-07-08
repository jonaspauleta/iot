// Normalize a reset time to integer unix seconds. Accepts an ISO8601 string, a
// millisecond epoch number, or a unix-seconds number. Returns 0 for falsy/invalid.
function toUnixSeconds(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v > 1e12 ? v / 1000 : v);
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? 0 : Math.round(ms / 1000);
}

module.exports = { toUnixSeconds };
