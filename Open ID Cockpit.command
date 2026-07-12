#!/bin/bash
# Double-click to open the ID Cockpit. Starts the server if it isn't already
# running, then opens it in your default browser. (If you installed auto-start,
# the server is already running and this just opens the page.)
DIR="/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/ID Platform"
if ! curl -s -o /dev/null http://127.0.0.1:8756/; then
  cd "$DIR"
  nohup /usr/bin/python3 serve.py >/dev/null 2>&1 &
  sleep 2
fi
open "http://127.0.0.1:8756"
