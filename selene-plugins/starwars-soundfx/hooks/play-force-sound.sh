#!/bin/bash
#
# Star Wars Sound FX — SubagentStart Hook
# Plays a lightsaber clash when a subagent is deployed.
# "Use the Force." — Every Jedi ever
#

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOUNDS_DIR="$PLUGIN_ROOT/sounds"

# macOS only
if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

if [ -f "$SOUNDS_DIR/clash.wav" ]; then
  afplay "$SOUNDS_DIR/clash.wav" &>/dev/null &
fi

exit 0
