#!/bin/bash
#
# Star Wars Sound FX — PostToolUse Hook
# Plays a random lightsaber swing after each tool use.
# Every tool call is a strike in the duel.
#
# 50/50 between swing-1 and swing-2
#

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOUNDS_DIR="$PLUGIN_ROOT/sounds"

# macOS only
if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

# 50/50 random between two swings
if [ $((RANDOM % 2)) -eq 0 ]; then
  SOUND_FILE="swing-1.wav"
else
  SOUND_FILE="swing-2.wav"
fi

if [ -f "$SOUNDS_DIR/$SOUND_FILE" ]; then
  afplay "$SOUNDS_DIR/$SOUND_FILE" &>/dev/null &
fi

exit 0
