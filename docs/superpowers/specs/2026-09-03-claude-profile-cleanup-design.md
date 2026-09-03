# Claude Profile Selection and Runtime Cleanup Design Spec

Date: 2026-09-03
Status: Approved for implementation

## Summary

Make the Claude usage provider target the dedicated `~/.claude-voltimum` Claude
Code profile by default, while allowing the profile directory to be overridden
with Claude Code's `CLAUDE_CONFIG_DIR` environment variable. The configured
profile credentials file takes precedence over the existing macOS Keychain
fallback. Codex, Cursor, and Grok remain enabled and keep their current order,
parsers, credentials, endpoints, and display behavior.

The same change includes a small reliability improvement in provider collection,
removal of one unused firmware field, and focused documentation cleanup.

## Goals

- Default Claude credential discovery to `$HOME/.claude-voltimum/.credentials.json`.
- Support `CLAUDE_CONFIG_DIR` for direct runs and LaunchAgent runs.
- Prefer the configured profile file over the shared Claude Keychain item.
- Do not read the legacy `$HOME/.claude/.credentials.json` path.
- Preserve Claude Keychain fallback for installations that do not expose a usable
  profile file.
- Keep Claude, Codex, Cursor, and Grok as the four fixed provider windows.
- Ensure one unexpected provider rejection cannot prevent the other windows from
  being sent to the device.
- Keep generated LaunchAgent XML valid for profile paths containing XML-sensitive
  characters.
- Keep credentials out of logs, fixtures, tests, and committed files.

## Non-goals

- No changes to Codex, Cursor, or Grok authentication or usage parsing.
- No changes to the serial frame schema or firmware rendering behavior.
- No migration or deletion of existing Claude credentials.
- No Claude token refresh or Keychain writes.
- No edits to the historical July design and implementation documents.

## Credential Selection

`mac/providers/claude.js` will resolve the profile directory as follows:

1. Use `process.env.CLAUDE_CONFIG_DIR` when it is set and non-empty.
2. Otherwise use `path.join(os.homedir(), '.claude-voltimum')`.

The credentials path is the resolved directory plus `.credentials.json`.
`readToken()` will attempt the sources in this order:

1. Read and parse the configured profile credentials file.
2. If that file is missing, malformed, or has no usable access token, read the
   existing Keychain item `Claude Code-credentials` for the current username.
3. If neither source yields a token, return `null` so `fetchClaude()` reports
   `reauth` as it does today.

The profile-first order is important because the Keychain service and account
lookup do not identify which Claude Code profile created the item. When the
dedicated profile file exists, it is the authoritative source for this display.
The old `~/.claude` file is not consulted, preventing an unrelated profile from
being selected silently.

The provider will expose a small `claudeCredentialsPath()` helper for unit tests.
The helper returns the path derived from the current environment without reading
the filesystem or credentials.

## LaunchAgent Propagation

`pusher.sh` will include an `EnvironmentVariables` dictionary in the generated
plist. Its `CLAUDE_CONFIG_DIR` value will be the value supplied when
`pusher.sh start` runs, or the default `$HOME/.claude-voltimum` when no override
is supplied.

This makes the following two modes consistent:

```bash
CLAUDE_CONFIG_DIR=/path/to/profile bun start
CLAUDE_CONFIG_DIR=/path/to/profile ./pusher.sh start
```

The existing LaunchAgent label, working directory, logging, restart behavior,
and serial ownership rules remain unchanged. Variable-derived plist values are
XML-escaped before interpolation, including the configured profile path.

## Provider Collection

`mac/push.js` will keep a fixed provider registry in this order:

1. Claude
2. Codex
3. Cursor
4. Grok

Collection will use `Promise.allSettled` rather than relying on every provider
wrapper to catch every possible failure. A rejected provider promise becomes a
window with its fixed provider name, `ok: false`, an empty `bars` array, and
`e: 'err'`. Fulfilled provider windows pass through unchanged. `buildFrame()`
and the serial schema remain unchanged, so the firmware still receives all four
windows on every successful collection cycle.

A small collection helper will accept the provider registry and be exported for
unit testing. The production path will use the fixed registry; the test seam in
`mac/push.test.js` will verify that one rejection produces one degraded window
while the remaining fulfilled windows are preserved in order. The new test file
will be added to the `mac/package.json` `test` script.

## Firmware and Documentation Cleanup

The following focused cleanup is included:

- Remove `haveGood` from `firmware/src/main.cpp`, since it is assigned but never
  read and is not needed for last-good bar retention.
- Remove the unmatched closing code fence at the end of `README.md`.
- Add a no-side-effect `pusher.test.sh` regression test for LaunchAgent profile
  propagation and XML escaping.
- Document the default `CLAUDE_CONFIG_DIR` behavior and override in `README.md`.
- Document `CLAUDE_CONFIG_DIR` alongside `PORT`, `POLL_MS`, `CODEX_HOME`, and
  `GROK_HOME` in `CLAUDE.md`.
- Keep the current documentation accurate about the hand-rolled, dependency-free
  serial implementation. Historical July documents remain archival references.

No provider window is removed, renamed, or reordered as part of cleanup.

## Error Handling

- Profile file missing or malformed: try the Keychain fallback.
- Both credential sources missing or unusable: Claude window is `reauth`.
- Existing Claude HTTP and parser mappings remain unchanged: 401 is `reauth`,
  429 is `stale`, other HTTP or parse failures are `err`.
- One provider rejection during collection: only that provider becomes `err`;
  the frame still contains all four windows.
- A profile path containing `&`, `<`, or `>` is XML-escaped in the generated
  plist and retains its original value when parsed by macOS.
- Serial disconnect and reconnect behavior is unchanged.
- No error path logs raw credential contents or HTTP authorization data.

## Testing and Verification

The implementation will add or update tests as follows:

- `mac/providers/claude.test.js` asserts the default credentials path and a
  custom `CLAUDE_CONFIG_DIR` path, restoring the process environment afterward.
- The Claude parser fixture assertions remain unchanged.
- `mac/push.test.js` exercises a rejected provider and verifies the degraded
  window plus preservation and ordering of the other three windows.
- `pusher.test.sh` generates a plist under a temporary home with a no-op
  `launchctl` and verifies a profile path containing `&` parses correctly.
- Existing Codex, Cursor, Grok, frame, JWT, and gRPC-web tests remain in the
  normal test command.

Verification commands:

```bash
cd mac && bun run test
bash -n pusher.sh
cd firmware && pio run
```

The test suite uses synthetic data only. Live credential checks are not required
for the implementation gate and must not print tokens.

## Acceptance Criteria

- With no override, Claude reads `~/.claude-voltimum/.credentials.json` before
  the Keychain and never reads `~/.claude/.credentials.json`.
- With `CLAUDE_CONFIG_DIR=/custom/profile`, Claude reads
  `/custom/profile/.credentials.json` before the Keychain.
- A custom profile path containing XML-sensitive characters remains a valid
  LaunchAgent plist and round-trips to the original path value.
- `./pusher.sh start` carries the effective Claude profile directory into its
  LaunchAgent plist.
- Frames still contain Claude, Codex, Cursor, and Grok in that order.
- An unexpected provider rejection does not drop the frame.
- All automated verification commands pass, or any unavailable hardware/toolchain
  check is reported explicitly.
