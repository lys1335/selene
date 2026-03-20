#!/bin/bash
#
# Star Wars Sound FX Plugin — Test Script
#
# Tests all hook scripts with simulated inputs.
# Run this to verify the plugin works before installing.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$SCRIPT_DIR/hooks"
SOUNDS_DIR="$SCRIPT_DIR/sounds"
PASS=0
FAIL=0

echo ""
echo "  ============================================="
echo "  Star Wars Sound FX Plugin — Test Suite"
echo "  ============================================="
echo ""

# Verify all sound files exist
echo "  Checking sound files..."
EXPECTED_SOUNDS=(
  "ignition.wav"
  "swing-1.wav"
  "swing-2.wav"
  "clash.wav"
  "sith-clash.wav"
)

for sound in "${EXPECTED_SOUNDS[@]}"; do
  if [ -f "$SOUNDS_DIR/$sound" ]; then
    SIZE=$(wc -c < "$SOUNDS_DIR/$sound" | tr -d ' ')
    echo "    $sound  ($SIZE bytes)"
    PASS=$((PASS + 1))
  else
    echo "    MISSING: $sound"
    FAIL=$((FAIL + 1))
  fi
done
echo ""

# Test each hook script
test_hook() {
  local name="$1"
  local script="$2"
  local input="$3"

  if [ ! -f "$script" ]; then
    echo "  MISSING: $script"
    FAIL=$((FAIL + 1))
    return
  fi

  if [ ! -x "$script" ]; then
    chmod +x "$script"
  fi

  echo -n "  Testing: $name ... "
  if echo "$input" | "$script" > /dev/null 2>&1; then
    echo "PASS"
    PASS=$((PASS + 1))
  else
    echo "FAIL"
    FAIL=$((FAIL + 1))
  fi
}

echo "  Hook Tests:"
echo "  -----------"

# SessionStart
test_hook "SessionStart (ignition)" \
  "$HOOKS_DIR/play-session-sound.sh" \
  '{"hook_type":"SessionStart","session_id":"test-1"}'

# PostToolUse (run 2 times for randomness)
test_hook "PostToolUse (swing #1)" \
  "$HOOKS_DIR/play-tool-sound.sh" \
  '{"hook_type":"PostToolUse","tool_name":"Write","tool_input":{}}'

test_hook "PostToolUse (swing #2)" \
  "$HOOKS_DIR/play-tool-sound.sh" \
  '{"hook_type":"PostToolUse","tool_name":"Edit","tool_input":{}}'

# PostToolUseFailure
test_hook "PostToolUseFailure (sith clash)" \
  "$HOOKS_DIR/play-failure-sound.sh" \
  '{"hook_type":"PostToolUseFailure","tool_name":"Bash","error":"Command failed"}'

# SubagentStart
test_hook "SubagentStart (clash)" \
  "$HOOKS_DIR/play-force-sound.sh" \
  '{"hook_type":"SubagentStart","session_id":"test-sub"}'

# Stop variants
test_hook "Stop: completed (swing-2)" \
  "$HOOKS_DIR/play-stop-sound.sh" \
  '{"hook_type":"Stop","session_id":"test-s1","stop_reason":"completed"}'

test_hook "Stop: error (sith clash)" \
  "$HOOKS_DIR/play-stop-sound.sh" \
  '{"hook_type":"Stop","session_id":"test-s2","stop_reason":"error"}'

test_hook "Stop: aborted (clash)" \
  "$HOOKS_DIR/play-stop-sound.sh" \
  '{"hook_type":"Stop","session_id":"test-s3","stop_reason":"aborted"}'

echo ""
echo "  ============================================="
echo "  Results: $PASS passed, $FAIL failed"
echo "  ============================================="
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo "  May the Force be with you."
echo ""
