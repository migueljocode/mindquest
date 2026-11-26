#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Open public/offline-solo.html in your browser for Solo mode."
  exit 1
fi

echo "Starting MindQuest Portable Server on http://localhost:3000 ..."
node server.mjs
