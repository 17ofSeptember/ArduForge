#!/bin/sh
# Linux. Run from a terminal, or mark it executable and run it from a file
# manager. All the logic is in scripts/start.mjs.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node was not found."
  echo ""
  echo "  Install Node 22 or newer with your distribution's package manager,"
  echo "  or from https://nodejs.org."
  echo ""
  exit 1
fi

exec node scripts/start.mjs
