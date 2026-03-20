#!/bin/bash
#
# Star Wars Sound FX — SessionStart Hook
# Plays lightsaber ignition when a new session begins.
# "Your weapon is your life." — Obi-Wan Kenobi
#

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOUNDS_DIR="$PLUGIN_ROOT/sounds"

# macOS only
if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

if [ -f "$SOUNDS_DIR/ignition.wav" ]; then
  afplay "$SOUNDS_DIR/ignition.wav" &>/dev/null &
fi

exit 0
