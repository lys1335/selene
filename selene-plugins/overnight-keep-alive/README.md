# overnight-keep-alive

A Selene / Claude Code plugin that refuses to let the agent stop until a
wall-clock deadline (default **06:00 local time**). When Claude tries to
emit a final response overnight, the `Stop` hook intercepts it and
re-rolls the turn with a system-reminder that tells Claude to keep
iterating on the current project.

Use it for unattended overnight builds where you want the agent to grind
continuously until morning instead of wrapping up and idling.

## What it does

On every `Stop` event the hook reads the local clock:

* If the current hour is **inside** the block window (default `0..5`):
  prints a Claude Code `{"decision":"block","reason":"…"}` JSON payload
  on stdout. Claude treats this as an instruction to keep going and
  injects the `reason` text as a system-reminder on the next turn.
* If the current hour is **outside** the window: exits 0 silently and
  allows normal stop.

The block `reason` includes:

1. Current local time and minutes remaining until the deadline.
2. A standing "GRAND RULE" instructing Claude to keep iterating, not
   ask questions, and never emit stubs/mocks/TODOs.
3. A "TASK LIST POLICY" telling Claude to put the current HH:MM at the
   top of its task list on every turn so the time-tracker stays visible.
4. The project-specific rules for the cycle-tracker React Native build
   (port Lumin 1:1, fan out Agents A–E, verify Definition of Done,
   commit on `feat/cycle-tracker`, open PR, leave decision log in
   `apps/cycle-tracker/DECISIONS.md`).

## Install

The plugin lives at `selene-plugins/overnight-keep-alive/`. You can wire
it up two ways, depending on which runtime you want to run under.

### Option A — Claude Code harness (primary, fully working)

Claude Code natively honors the `{"decision":"block","reason":"…"}`
stdout contract on `Stop` hooks. Register the plugin via project
settings (`.claude/settings.json`) using an inline marketplace pointing
at this directory, or copy the `hooks/hooks.json` content directly into
`.claude/settings.json` under `hooks.Stop`.

Minimal example — drop this into your project `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /Users/ogkai/Desktop/apps/new-selene/selene/selene-plugins/overnight-keep-alive/hooks/reroll-until-6am.sh",
            "timeout": 15,
            "statusMessage": "Overnight keep-alive: checking wall-clock deadline..."
          }
        ]
      }
    ]
  }
}
```

Or register the plugin directory as a marketplace source and enable it
via `/plugin`.

### Option B — Selene chat runtime (requires a tiny engine patch)

`lib/plugins/hooks-engine.ts` currently dispatches `Stop` hooks
fire-and-forget (only `PreToolUse` honors exit-code-2 blocking). For
this plugin to actually re-roll a Selene chat turn, extend the Stop
handling to parse stdout JSON and enqueue a live-prompt, for example:

```ts
// lib/plugins/hook-integration.ts, inside runStopHooks:
if (event === "Stop" && result.stdout) {
  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed?.decision === "block" && parsed?.reason) {
      enqueueLivePrompt(sessionId, {
        content: parsed.reason,
        metadata: { source: "stop-hook-block", plugin: source.pluginName },
      });
    }
  } catch { /* not JSON, ignore */ }
}
```

Until that patch lands, the plugin is a no-op in the Selene chat
pipeline — it will still run, but Selene will complete the turn anyway.

## Configuration

All options are read as environment variables at hook fire time, so you
can set them in your shell, `.claude/settings.json`'s `env` block, or
via your process supervisor.

| Env var                          | Default | Meaning                                                                 |
| -------------------------------- | ------- | ----------------------------------------------------------------------- |
| `SELENE_OVERNIGHT_END_HOUR`      | `6`     | Allow stops at this hour and later. Integers 0..23.                     |
| `SELENE_OVERNIGHT_START_HOUR`    | `0`     | Lower bound of the block window. Stops before this hour are allowed.    |
| `SELENE_OVERNIGHT_WRAP`          | `1`     | If 1 and `END <= START`, the window wraps midnight (e.g. 22..06).       |
| `SELENE_OVERNIGHT_TASK_FILE`     | unset   | Optional path; contents are appended to the block `reason` for project-specific rules. |

Examples:

```bash
# Default: block stops while local hour is 00..05.
# (no env needed)

# Block stops between 22:00 and 05:59 (wrapping midnight):
export SELENE_OVERNIGHT_START_HOUR=22
export SELENE_OVERNIGHT_END_HOUR=6
export SELENE_OVERNIGHT_WRAP=1

# Run until 08:00 instead of 06:00:
export SELENE_OVERNIGHT_END_HOUR=8

# Inject additional per-project instructions into every re-roll:
export SELENE_OVERNIGHT_TASK_FILE=/path/to/your/project/OVERNIGHT_RULES.md
```

## Manually test the hook

```bash
# Expect a block JSON on stdout when forced into the window (no clock-
# mocking here, so pick a START/END that actually includes 'now'):
echo '{"hook_type":"Stop"}' \
  | SELENE_OVERNIGHT_START_HOUR=0 SELENE_OVERNIGHT_END_HOUR=24 \
    bash hooks/reroll-until-6am.sh \
  | jq -e '.decision == "block"'
```

## Files

```
overnight-keep-alive/
├── .claude-plugin/plugin.json      # manifest
├── hooks/
│   ├── hooks.json                  # Stop event → script
│   └── reroll-until-6am.sh         # the actual hook (executable)
└── README.md
```

## Disabling

Remove the plugin from `enabledPlugins` in `.claude/settings.json`, or
set `SELENE_OVERNIGHT_START_HOUR=SELENE_OVERNIGHT_END_HOUR` to produce
an empty block window.

## Known limitations

1. **Selene runtime doesn't yet honor Stop-block decisions.** See
   Option B above. Small engine patch needed.
2. The hook uses local-clock hours from `date +%H`. If the process
   clock is skewed (e.g. inside a misconfigured container), the block
   window is skewed too.
3. The hook times out after 15 s. If the agent crashes during a
   re-roll, there is no watchdog to restart it — this plugin only
   prevents stops, it doesn't restart a dead stream.
4. The reason text is ~5.8 KB per re-roll. If you fire this hundreds of
   times per night it adds to context. Consider shortening the `REASON`
   heredoc or moving to `SELENE_OVERNIGHT_TASK_FILE` with a much smaller
   in-script reason.
