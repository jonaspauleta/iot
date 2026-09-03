#!/usr/bin/env bash
# Manage the M5Stack usage pusher as a macOS LaunchAgent.
# Usage: ./pusher.sh {start|stop|restart|status|logs}
#   start   install/refresh the LaunchAgent plist and load it (auto-starts at login)
#   stop    unload the LaunchAgent (frees the serial port, e.g. before reflashing)
#   restart stop then start
#   status  show the agent state + which process holds the serial port
#   logs    tail the pusher log
set -euo pipefail

LABEL="com.jonaspauleta.m5usage"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MACDIR="$ROOT/mac"
BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"
LOG="$HOME/Library/Logs/m5-usage.log"
DOMAIN="gui/$(id -u)"
CLAUDE_CONFIG_DIR_VALUE="${CLAUDE_CONFIG_DIR:-$HOME/.claude-voltimum}"

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "$value"
}

BUN_XML="$(xml_escape "$BUN")"
MACDIR_XML="$(xml_escape "$MACDIR")"
LOG_XML="$(xml_escape "$LOG")"
CLAUDE_CONFIG_DIR_XML="$(xml_escape "$CLAUDE_CONFIG_DIR_VALUE")"

write_plist() {
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>            <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BUN_XML</string>
        <string>push.js</string>
    </array>
    <key>WorkingDirectory</key>  <string>$MACDIR_XML</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>CLAUDE_CONFIG_DIR</key><string>$CLAUDE_CONFIG_DIR_XML</string>
    </dict>
    <key>RunAtLoad</key>         <true/>
    <key>KeepAlive</key>         <true/>
    <key>StandardOutPath</key>   <string>$LOG_XML</string>
    <key>StandardErrorPath</key> <string>$LOG_XML</string>
</dict>
</plist>
EOF
}

case "${1:-}" in
  start)
    write_plist
    # bootout first so re-running start picks up any plist change idempotently.
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "started $LABEL"
    echo "logs: $LOG"
    ;;
  stop)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    echo "stopped $LABEL"
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl print "$DOMAIN/$LABEL" | grep -E "state =|pid =" || true
    else
      echo "not loaded"
    fi
    lsof /dev/cu.usbserial-* 2>/dev/null | tail -1 || echo "serial port: free"
    ;;
  logs)
    tail -f "$LOG"
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
