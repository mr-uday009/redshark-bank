#!/bin/sh
# Install the Db2 JDBC bridge as a macOS launchd user agent.
#
# Why: the bridge is a long-lived local service, but a process started from a
# terminal (or from an editor's task runner) dies with that shell. launchd keeps
# it running and restarts it if it crashes, so the website always has a live
# connection to Db2 for z/OS.
#
#   ./install-service.sh          install and start
#   ./install-service.sh status   show state
#   ./install-service.sh logs     tail the log
#   ./install-service.sh remove   stop and uninstall

set -e

BRIDGE_DIR=$(cd "$(dirname "$0")" && pwd)
LABEL="com.redshark.db2bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/redshark-bank"
UID_NUM=$(id -u)

case "${1:-install}" in
  status)
    launchctl list | grep "$LABEL" || echo "not loaded"
    exit 0
    ;;
  logs)
    tail -n 40 "$LOG_DIR/db2bridge.log" 2>/dev/null || echo "no log yet"
    exit 0
    ;;
  remove)
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL"
    exit 0
    ;;
  install) ;;
  *)
    echo "usage: $0 [install|status|logs|remove]" >&2
    exit 1
    ;;
esac

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$BRIDGE_DIR/start.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$BRIDGE_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/db2bridge.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/db2bridge.log</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl enable "gui/$UID_NUM/$LABEL"

sleep 4
if curl -s --max-time 10 http://127.0.0.1:8099/health | grep -q '"connected":true'; then
  echo "bridge is up and connected to Db2"
  curl -s --max-time 10 http://127.0.0.1:8099/health
  echo
else
  echo "installed, but the bridge did not report connected yet."
  echo "check: $0 logs"
fi
