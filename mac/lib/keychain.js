// Read a generic-password secret from the macOS login Keychain via the system
// `security` binary. Must be the literal /usr/bin/security: some items (Cursor)
// pin their ACL to it, and any other reader triggers a GUI prompt.
function readKeychain(service, account) {
  try {
    const r = Bun.spawnSync([
      '/usr/bin/security',
      'find-generic-password',
      '-s',
      service,
      '-a',
      account,
      '-w',
    ]);
    if (r.exitCode !== 0) return null;
    const out = r.stdout.toString('utf8').trim();
    return out || null;
  } catch {
    return null;
  }
}

module.exports = { readKeychain };
