#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_HOME="$(mktemp -d)"
trap 'rm -rf "$TEMP_HOME"' EXIT

mkdir -p "$TEMP_HOME/bin"
ln -s /usr/bin/true "$TEMP_HOME/bin/launchctl"

HOME="$TEMP_HOME/home" \
PATH="$TEMP_HOME/bin:$PATH" \
CLAUDE_CONFIG_DIR='/tmp/profile/a&b' \
"$ROOT/pusher.sh" start >/dev/null

PLIST="$TEMP_HOME/home/Library/LaunchAgents/com.jonaspauleta.m5usage.plist"
profile=$(/usr/bin/plutil -extract EnvironmentVariables.CLAUDE_CONFIG_DIR raw -o - "$PLIST")
if [[ "$profile" != '/tmp/profile/a&b' ]]; then
  printf 'unexpected Claude profile in plist: %s\n' "$profile" >&2
  exit 1
fi

printf 'pusher: profile plist value passed\n'
