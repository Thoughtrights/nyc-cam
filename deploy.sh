#!/usr/bin/env bash
# Deploy NYC Cam Explorer to production
# Usage: ./deploy.sh
# Requires: SSH alias "thoughtrights" configured in ~/.ssh/config

set -e

DEST="thoughtrights:docroot/cam/"
FILES=(
  index.html
  app.js
  style.css
  config.json
  defaults.json
  favicon.png
  logo-mid.png
)

echo "🚀 Deploying to $DEST ..."
rsync -avz --progress "${FILES[@]}" "$DEST"
echo "✅ Done."
