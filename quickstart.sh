#!/usr/bin/env bash
# quickstart.sh — one-command setup for Mythos (Mac / Linux)
#
# Run this from the repo root:
#     ./quickstart.sh
#   (or, if that doesn't run:  bash quickstart.sh)
#
# It wraps the normal setup flow (npm install + npm run setup) so a beginner can
# get going with a single command. It never installs Node.js for you — if Node is
# missing it points you at the official download and stops. Safe to run again.

set -euo pipefail

echo ''
echo 'Setting up Mythos...'
echo ''

# Must be run from the repo root (where package.json lives).
if [ ! -f package.json ]; then
  echo "I can't find package.json in this folder, so I'm probably not in the project root."
  echo "Open the repo folder first, then re-run me. For example:"
  echo ''
  echo '    cd learning-language-models'
  echo '    ./quickstart.sh'
  echo ''
  exit 1
fi

# 1. Node.js — required. We check, we do NOT install it for you.
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed yet (or isn't on your PATH)."
  echo ''
  echo '  1. Go to https://nodejs.org'
  echo '  2. Download the version labelled LTS (the stable one).'
  echo '  3. Run the installer with all the default options.'
  echo '  4. Restart this window and run me again.'
  echo ''
  echo "That's the only thing you need to install by hand. Once Node is there, this script handles the rest."
  exit 1
fi
echo "  Found Node.js $(node --version)"

# 2. npm — ships with Node, but confirm it's reachable.
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is here, but npm isn't reachable. npm normally installs alongside Node.js."
  echo "Try reinstalling Node.js from https://nodejs.org (LTS), then run me again."
  exit 1
fi
echo "  Found npm $(npm --version)"
echo ''

# 3. Install dependencies.
echo 'Installing dependencies (npm install)...'
if ! npm install; then
  echo ''
  echo "npm install ran into a problem."
  echo "Scroll up for the details. You can copy the red text and ask your AI assistant what it means, then run me again."
  exit 1
fi
echo ''

# 4. Run the friendly first-run setup check.
echo 'Running the setup check (npm run setup)...'
if ! npm run setup; then
  echo ''
  echo "Setup finished with items to resolve."
  echo "Read the notes above — they tell you exactly what to fix. Then run me again."
  exit 1
fi

# 5. Done — point them at the next step.
echo ''
echo "You're set up. Here's your first run:"
echo ''
echo '  1. Open this folder in your AI coding assistant (Claude Code, Cursor, Codex, OpenCode).'
echo '  2. Read the "Your first quest" section in QUICKSTART.md, then just ask'
echo '     the assistant in plain English to cast a Silver-rank (or higher) grimoire for you.'
echo '  3. When you want to know why a SECOND, different mind should review the work,'
echo '     read docs/GUILD-CHARTER.md.'
echo ''
echo 'Welcome aboard.'
exit 0
