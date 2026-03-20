#!/bin/bash
#
# Star Wars Sound FX Plugin — Setup
#
# Makes hook scripts executable and verifies sound files are present.
# Run this once after cloning or installing the plugin.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOUNDS_DIR="$SCRIPT_DIR/sounds"

echo ""
echo "  Setting up Star Wars Sound FX Plugin..."
echo ""

# Make all hook scripts executable
chmod +x "$SCRIPT_DIR/hooks/"*.sh
echo "  Made hook scripts executable."

# Verify sound files
EXPECTED_SOUNDS=("ignition.wav" "clash.wav" "swing-1.wav" "swing-2.wav" "sith-clash.wav")
MISSING=0

echo ""
echo "  Checking sound files..."
for sound in "${EXPECTED_SOUNDS[@]}"; do
  if [ -f "$SOUNDS_DIR/$sound" ]; then
    echo "    ✓ $sound"
  else
    echo "    ✗ MISSING: $sound"
    MISSING=$((MISSING + 1))
  fi
done

if [ "$MISSING" -gt 0 ]; then
  echo ""
  echo "  ⚠ $MISSING sound file(s) missing. Add them to sounds/ directory."
  exit 1
fi

echo ""
echo "  Setup complete. May the Force be with you."
echo ""
