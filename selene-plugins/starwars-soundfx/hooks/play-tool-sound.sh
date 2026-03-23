#!/bin/bash
#
# Star Wars Sound FX — PostToolUse Hook
# Plays a random lightsaber swing after each tool use.
# Every tool call is a strike in the duel.
#
# Rotates between swing-1, swing-2, and clash
#

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOUNDS_DIR="$PLUGIN_ROOT/sounds"

# macOS only
if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

# 1-in-3 random between three sounds
ROLL=$((RANDOM % 3))
if [ $ROLL -eq 0 ]; then
  SOUND_FILE="swing-1.wav"
elif [ $ROLL -eq 1 ]; then
  SOUND_FILE="swing-2.wav"
else
  SOUND_FILE="clash.wav"
fi

if [ -f "$SOUNDS_DIR/$SOUND_FILE" ]; then
  afplay "$SOUNDS_DIR/$SOUND_FILE" &>/dev/null &
fi

exit 0
