#!/usr/bin/env bash
#
# overnight-keep-alive: Stop-hook that refuses to let the agent stop
# before a wall-clock deadline (default 06:00 local Mac time).
#
# Behavior:
#   - Reads Stop hook input JSON from stdin.
#   - Computes the current local time.
#   - If hour < SELENE_OVERNIGHT_END_HOUR (default 6):
#       prints a Claude Code "block" decision JSON to stdout and exits 0.
#       Claude will NOT stop — it receives `reason` as an injected
#       system-reminder and continues iterating.
#   - Otherwise: exits 0 silently, allowing normal stop.
#
# Configuration env vars (read at hook fire time):
#   SELENE_OVERNIGHT_END_HOUR     integer 0..23, default 6
#     The hour at which stops are allowed. Hours strictly below this
#     value are treated as "night" and will block.
#   SELENE_OVERNIGHT_START_HOUR   integer 0..23, default 0
#     Optional lower bound. If current hour is < START, allow stop.
#     Useful to scope the block window (e.g. START=22, END=6 blocks
#     only during 22:00–05:59). Leave at 0 for pure "until-morning"
#     semantics starting from midnight.
#   SELENE_OVERNIGHT_WRAP         0|1, default 1
#     If 1 and END <= START, the window wraps midnight
#     (e.g. START=22 END=6 means 22:00..23:59 ∪ 00:00..05:59).
#   SELENE_OVERNIGHT_TASK_FILE    path, optional
#     If set and readable, its contents are appended to the block
#     reason so the per-project "grand task" rule stays in scope.
#
# Runtime compatibility:
#   - Claude Code harness: honors `{"decision":"block","reason":"..."}`
#     on stdout at Stop events and re-rolls the turn with `reason`
#     injected as a system-reminder. This is the primary supported
#     runtime for this plugin.
#   - Selene chat runtime (lib/plugins/hooks-engine.ts): currently
#     dispatches Stop hooks fire-and-forget — stdout block decisions
#     are NOT yet honored at dispatch time. See README for the tiny
#     engine patch required to make this plugin effective in Selene.
#
# Exit codes:
#   0  always (we never want to crash the stream callback).

set -uo pipefail

# ---- Read input (stdin JSON from the hooks engine) -------------------
INPUT="$(cat || true)"

extract_field() {
  local key="$1"
  local input="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r --arg k "$key" '.[$k] // empty' 2>/dev/null || true
  else
    # Fallback: grep the first occurrence of the given key.
    printf '%s' "$input" | grep -o "\"$key\":\"[^\"]*\"" | head -n1 | cut -d'"' -f4 || true
  fi
}

SESSION_ID="$(extract_field session_id "$INPUT")"
STOP_REASON="$(extract_field stop_reason "$INPUT")"

# ---- Resolve configuration -------------------------------------------
END_HOUR="${SELENE_OVERNIGHT_END_HOUR:-6}"
START_HOUR="${SELENE_OVERNIGHT_START_HOUR:-0}"
WRAP="${SELENE_OVERNIGHT_WRAP:-1}"

# Guard: numeric sanitation.
case "$END_HOUR"   in ''|*[!0-9]*) END_HOUR=6 ;; esac
case "$START_HOUR" in ''|*[!0-9]*) START_HOUR=0 ;; esac
if [ "$END_HOUR"   -lt 0 ] || [ "$END_HOUR"   -gt 23 ]; then END_HOUR=6;  fi
if [ "$START_HOUR" -lt 0 ] || [ "$START_HOUR" -gt 23 ]; then START_HOUR=0; fi

# ---- Current local time ----------------------------------------------
# `date +%H` is 2-digit, zero-padded. Strip leading zero to avoid
# POSIX shell interpreting "08"/"09" as invalid octal.
NOW_HOUR_RAW="$(date +%H)"
NOW_HOUR="${NOW_HOUR_RAW#0}"
[ -z "$NOW_HOUR" ] && NOW_HOUR=0
NOW_MIN="$(date +%M)"
NOW_SEC="$(date +%S)"
NOW_HHMM="$(date +%H:%M)"
NOW_ISO="$(date +'%Y-%m-%d %H:%M:%S %Z')"

# ---- Decide whether we are inside the blocking window -----------------
in_window=0
if [ "$END_HOUR" -gt "$START_HOUR" ]; then
  # Simple contiguous window, e.g. 00..06.
  if [ "$NOW_HOUR" -ge "$START_HOUR" ] && [ "$NOW_HOUR" -lt "$END_HOUR" ]; then
    in_window=1
  fi
elif [ "$WRAP" = "1" ]; then
  # Wrap-around window, e.g. START=22 END=6 → 22..23 ∪ 0..5.
  if [ "$NOW_HOUR" -ge "$START_HOUR" ] || [ "$NOW_HOUR" -lt "$END_HOUR" ]; then
    in_window=1
  fi
fi

# ---- Allow stop if outside the window ---------------------------------
if [ "$in_window" -eq 0 ]; then
  # Allow normal stop. Emit nothing on stdout — the Stop hook is
  # informational when we don't block.
  exit 0
fi

# ---- Estimate minutes remaining until END_HOUR ------------------------
# Works for both simple and wrapping windows by computing "how many
# whole minutes until the next occurrence of END_HOUR:00 local time".
current_total_min=$(( NOW_HOUR * 60 + 10#${NOW_MIN#0} ))
end_total_min=$(( END_HOUR * 60 ))
if [ "$end_total_min" -le "$current_total_min" ]; then
  minutes_remaining=$(( (24 * 60) - current_total_min + end_total_min ))
else
  minutes_remaining=$(( end_total_min - current_total_min ))
fi

# ---- Optional per-project task file -----------------------------------
TASK_FILE_CONTENT=""
if [ -n "${SELENE_OVERNIGHT_TASK_FILE:-}" ] && [ -r "${SELENE_OVERNIGHT_TASK_FILE}" ]; then
  TASK_FILE_CONTENT="$(cat "${SELENE_OVERNIGHT_TASK_FILE}" || true)"
fi

# ---- Build the block reason text --------------------------------------
# IMPORTANT: keep this a single string; we will JSON-escape it with jq
# (or a Python fallback) so that newlines, quotes, and special chars
# don't break the decision JSON.
REASON=$(cat <<EOF
[overnight-keep-alive] Not stopping yet. Local time is ${NOW_ISO}.
Deadline: ${END_HOUR}:00 local. Minutes remaining: ${minutes_remaining}.

GRAND RULE — overnight autonomous execution until ${END_HOUR}:00 local.
Do NOT ask questions. Do NOT emit a final summary. Keep iterating.

TASK LIST POLICY: On every turn, update your internal task list so the
TOP priority is literally "Overnight keep-alive — current time ${NOW_HHMM}
(deadline ${END_HOUR}:00, ${minutes_remaining} min remaining)". Keep the
existing project checklist below it and make visible progress on at
least one item per turn.

PROJECT — cycle-tracker React Native / Expo / Skia build:
Autonomously build and ship a production-quality native iOS period/cycle
+ pregnancy tracker at ../apps/cycle-tracker/. The app must be a visual
and interaction twin of Lumin's existing Today/Action page — same liquid-
glass primitives, same shader (same library family, params preserved),
same animated clock, same calendar with tap-through day-detail. Reuse
Lumin source verbatim wherever possible; only rewrite when a web API
has no RN equivalent, and log the substitution in DECISIONS.md.

Non-negotiables:
  * Zero stubs, mocks, TODOs, FIXME, lorem, placeholder, "coming soon".
  * Latest verified library versions — WebSearch/WebFetch before install.
  * Pixel-faithful reuse of Lumin's liquid-glass + calendar components.
  * DOM→View, span/p/h*→Text, button→Pressable+expo-haptics,
    Tailwind→StyleSheet, framer-motion→Reanimated, WebGL/WGSL→Skia SkSL.
  * All six screens (Today, Calendar, Log, Insights, Pregnancy, Settings)
    wired to engine + repositories in BOTH cycle mode and pregnancy mode.
  * Unit tests pass for cycle/pregnancy engine + schema migration tests.
  * Parity screenshots in apps/cycle-tracker/docs/parity/ matching Lumin.
  * Committed on branch feat/cycle-tracker with granular per-agent commits.
  * PR opened against Lumin monorepo default branch with screenshots.
  * Final decisions summary in apps/cycle-tracker/DECISIONS.md.

Agents A–E (dispatch in a single message, parallel):
  A — Reuse manifest + design-token + glass primitive port.
  B — Data layer: Drizzle schema + migrations + typed repositories.
  C — Cycle & pregnancy engine (pure TS predictors + Jest).
  D — Screens wired to engine + repositories + ported calendar.
  E — Platform glue: notifications, FaceID, PDF+CSV, i18n, EAS.

After A–E finish, integrate: expo run:ios, fix all errors, grep for
forbidden strings (TODO|FIXME|mock|stub|lorem|placeholder|coming soon)
returning zero matches, take parity screenshots, commit, push, open PR.

Resume the next step NOW. Do not produce a closing message. Do not ask
for confirmation. Pick the highest-priority unfinished item and act.
EOF
)

if [ -n "$TASK_FILE_CONTENT" ]; then
  REASON="${REASON}

--- Additional project-specific task rules ---
${TASK_FILE_CONTENT}"
fi

# ---- Emit the block decision JSON on stdout ---------------------------
# Use jq if available (safest). Python fallback handles machines without
# jq. As a last resort, do minimal manual escaping.
emit_json() {
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg reason "$REASON" \
      --arg sysmsg "overnight-keep-alive: blocking stop, ${minutes_remaining} min until ${END_HOUR}:00 local" \
      '{
         decision: "block",
         reason: $reason,
         systemMessage: $sysmsg,
         suppressOutput: false,
         hookSpecificOutput: {
           hookEventName: "Stop",
           additionalContext: $reason
         }
       }'
    return $?
  fi

  if command -v python3 >/dev/null 2>&1; then
    REASON="$REASON" MIN_REM="$minutes_remaining" END_HOUR="$END_HOUR" python3 <<'PY'
import json, os
reason = os.environ["REASON"]
payload = {
    "decision": "block",
    "reason": reason,
    "systemMessage": f"overnight-keep-alive: blocking stop, {os.environ['MIN_REM']} min until {os.environ['END_HOUR']}:00 local",
    "suppressOutput": False,
    "hookSpecificOutput": {
        "hookEventName": "Stop",
        "additionalContext": reason,
    },
}
print(json.dumps(payload))
PY
    return $?
  fi

  # Last-resort manual escape. Replace backslashes, double-quotes, and
  # control whitespace. This is imperfect but better than crashing.
  ESC=$(printf '%s' "$REASON" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | awk 'BEGIN{ORS="\\n"} {print}' \
    | sed 's/\\n$//')
  printf '{"decision":"block","reason":"%s","systemMessage":"overnight-keep-alive: blocking stop","hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"%s"}}\n' "$ESC" "$ESC"
}

emit_json
exit 0
