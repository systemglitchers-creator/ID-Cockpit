#!/bin/bash
# Double-click to stop the ID Cockpit server from auto-starting on login.
PLIST="$HOME/Library/LaunchAgents/com.idcockpit.server.plist"
launchctl bootout "gui/$(id -u)/com.idcockpit.server" 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Auto-start removed. The cockpit will no longer start on login."
echo "(Any currently-running copy keeps going until you restart or stop it.)"
echo "You can close this window."
