#!/usr/bin/env bash
set -euo pipefail

# Usage: DECK_HOST=deck@192.168.1.50 ./deploy.sh
DECK_HOST="${DECK_HOST:?Set DECK_HOST, e.g. DECK_HOST=deck@192.168.1.50 ./deploy.sh}"
PLUGIN_NAME="decky-session-notes"
REMOTE_DIR="homebrew/plugins/${PLUGIN_NAME}"

echo "Building..."
pnpm run build

echo "Ensuring plugins dir is writable..."
ssh "$DECK_HOST" "sudo mkdir -p ~/${REMOTE_DIR} && sudo chown -R \$(whoami):\$(whoami) ~/homebrew/plugins"

echo "Syncing to ${DECK_HOST}:${REMOTE_DIR}..."
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude 'src' \
  --exclude '.git' \
  --exclude 'rollup.config.js' \
  --exclude 'tsconfig.json' \
  --exclude 'pnpm-workspace.yaml' \
  --exclude '.gitignore' \
  --exclude 'deploy.sh' \
  --exclude 'server' \
  ./ "${DECK_HOST}:${REMOTE_DIR}/"

echo "Restarting plugin_loader..."
ssh "$DECK_HOST" "sudo systemctl restart plugin_loader"

echo "Done. Open the Quick Access Menu on the Deck and check the plugin list."
