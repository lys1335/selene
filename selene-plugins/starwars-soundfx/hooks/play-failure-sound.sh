#!/bin/bash
#
# Star Wars Sound FX — PostToolUseFailure Hook
# Plays a dark clash when a tool fails.
# "I find your lack of faith disturbing." — Darth Vader
#

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOUNDS_DIR="$PLUGIN_ROOT/sounds"

# macOS only
if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

if [ -f "$SOUNDS_DIR/sith-clash.wav" ]; then
  afplay "$SOUNDS_DIR/sith-clash.wav" &>/dev/null &
fi

exit 0
