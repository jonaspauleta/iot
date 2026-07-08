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
        <string>$BUN</string>
        <string>push.js</string>
    </array>
    <key>WorkingDirectory</key>  <string>$MACDIR</string>
    <key>RunAtLoad</key>         <true/>
    <key>KeepAlive</key>         <true/>
    <key>StandardOutPath</key>   <string>$LOG</string>
    <key>StandardErrorPath</key> <string>$LOG</string>
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
