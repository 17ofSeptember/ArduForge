#!/bin/bash
# macOS. Finder runs a .command in Terminal on double-click.
# All the logic is in scripts/start.mjs; this only finds it and runs it.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node was not found."
  echo ""
  echo "  Install it from https://nodejs.org, or with Homebrew:"
  echo "      brew install node@22"
  echo ""
  echo "  Homebrew's node@22 is keg-only, so it also needs to be on PATH:"
  echo "      echo 'export PATH=\"/usr/local/opt/node@22/bin:\$PATH\"' >> ~/.zshrc"
  echo ""
  echo "  Press any key to close."
  read -r -n 1 -s
  exit 1
fi

node scripts/start.mjs
status=$?

# A double-clicked window vanishes on exit and takes the error with it.
if [ $status -ne 0 ]; then
  echo ""
  echo "  ArduForge exited with status $status. Press any key to close."
  read -r -n 1 -s
fi
exit $status
