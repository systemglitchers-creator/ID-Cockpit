#!/bin/bash
# Double-click ONCE to let the dashboard draft cards/questions on your Claude
# subscription. Installs the Claude CLI if needed, logs you in, and saves config.
set -e
DIR="/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/ID Platform"
echo "Setting up AI drafting for the ID Cockpit..."

if ! command -v claude >/dev/null 2>&1; then
  echo "Installing the Claude CLI (npm i -g @anthropic-ai/claude-code)..."
  npm install -g @anthropic-ai/claude-code
fi
CLAUDE="$(command -v claude || true)"
if [ -z "$CLAUDE" ]; then
  echo "Could not find 'claude' after install. Open a terminal, run 'npm i -g @anthropic-ai/claude-code', then re-run this."
  exit 1
fi

echo "Logging you into Claude (a browser window will open). Use your Claude subscription account..."
"$CLAUDE" login || true

python3 - "$DIR" "$CLAUDE" <<'PY'
import json, sys, pathlib
d, claude = sys.argv[1], sys.argv[2]
cfg = {"claudePath": claude, "model": None, "timeoutSec": 240}
pathlib.Path(d, "config.json").write_text(json.dumps(cfg, indent=2))
print("Saved config.json ->", claude)
PY

echo "Done. AI drafting is enabled. You can close this window."
