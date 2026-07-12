#!/bin/bash
# Double-click this ONCE to make the ID Cockpit server start automatically
# every time you log in. After this, just click the Dock app (or open
# http://127.0.0.1:8756). To undo, double-click "Uninstall Auto-Start.command".
set -e
DIR="/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/ID Platform"
PLIST="$HOME/Library/LaunchAgents/com.idcockpit.server.plist"

echo "Installing ID Cockpit auto-start..."
mkdir -p "$HOME/Library/LaunchAgents"
cp "$DIR/launch/com.idcockpit.server.plist" "$PLIST"

# reload cleanly (ignore errors if not yet loaded)
launchctl bootout "gui/$(id -u)/com.idcockpit.server" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.idcockpit.server" 2>/dev/null || true

sleep 2
if curl -s -o /dev/null http://127.0.0.1:8756/; then
  echo "Done — the cockpit is running and will start on every login."
  open "http://127.0.0.1:8756"
else
  echo "Installed, but the server didn't answer yet. Give it a few seconds, then open http://127.0.0.1:8756"
fi
echo ""
echo "You can close this window."
