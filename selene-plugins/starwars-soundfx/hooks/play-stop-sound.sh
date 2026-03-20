#!/bin/bash
#
# Star Wars Sound FX — Stop Hook
# Plays different sounds based on how the session ended:
#
#   completed → swing-2 (triumphant swing)
#   error     → sith-clash (dark side hit)
#   aborted   → clash (disengage)
#

set -e

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOUNDS_DIR="$PLUGIN_ROOT/sounds"

# Read hook input from stdin
INPUT=$(cat)

# Extract stop reason
if command -v jq &> /dev/null; then
  STOP_REASON=$(echo "$INPUT" | jq -r '.stop_reason // "unknown"')
else
  STOP_REASON=$(echo "$INPUT" | grep -o '"stop_reason":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
fi

# macOS only
if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

case "$STOP_REASON" in
  "completed")
    if [ -f "$SOUNDS_DIR/swing-2.wav" ]; then
      afplay "$SOUNDS_DIR/swing-2.wav" &>/dev/null &
    fi
    ;;
  "error")
    if [ -f "$SOUNDS_DIR/sith-clash.wav" ]; then
      afplay "$SOUNDS_DIR/sith-clash.wav" &>/dev/null &
    fi
    ;;
  "aborted")
    if [ -f "$SOUNDS_DIR/clash.wav" ]; then
      afplay "$SOUNDS_DIR/clash.wav" &>/dev/null &
    fi
    ;;
  *)
    if [ -f "$SOUNDS_DIR/clash.wav" ]; then
      afplay "$SOUNDS_DIR/clash.wav" &>/dev/null &
    fi
    ;;
esac

# Always exit 0 — don't block the Stop hook
exit 0
