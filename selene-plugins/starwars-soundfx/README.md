# Star Wars Sound FX Plugin

Turn your Selene agent sessions into lightsaber duels. Every tool call is a swing, subagent deploys get a clash, and stop events play different sounds based on outcome.

macOS only (`afplay`).

## Sound Map

| Event | Sound File | Description |
|---|---|---|
| **Session start** | `ignition.wav` | Lightsaber ignition |
| **Tool use** | `swing-1.wav` / `swing-2.wav` | 50/50 random swing |
| **Tool failure** | `sith-clash.wav` | Dark side hit |
| **Subagent deploy** | `clash.wav` | Lightsaber clash |
| **Task completed** | `swing-2.wav` | Triumphant swing |
| **Task error** | `sith-clash.wav` | Dark side hit |
| **Task aborted** | `clash.wav` | Disengage |

5 sound files total — all from real recordings, no synthesized audio.

## Setup

```bash
cd starwars-soundfx
chmod +x setup.sh && ./setup.sh
```

Verifies all sound files are present and makes hook scripts executable.

## Installation

### Drag & Drop
1. Drag the `starwars-soundfx` folder into Selene
2. Enable it in the plugin manager

### Manual
```bash
cp -r starwars-soundfx ~/.claude/plugins/
cd ~/.claude/plugins/starwars-soundfx && ./setup.sh
```

## Testing

```bash
./test-hook.sh
```

Runs all hook scripts with simulated inputs and verifies sound files exist.

## Plugin Structure

```
starwars-soundfx/
├── .claude-plugin              # Plugin marker file
├── hooks/
│   ├── hooks.json             # Hook event → script mapping
│   ├── play-session-sound.sh  # SessionStart handler
│   ├── play-tool-sound.sh     # PostToolUse handler
│   ├── play-failure-sound.sh  # PostToolUseFailure handler
│   ├── play-force-sound.sh    # SubagentStart handler
│   └── play-stop-sound.sh     # Stop handler
├── sounds/
│   ├── ignition.wav           # Saber ignition (from saber_1 first half)
│   ├── clash.wav              # Saber clash (from saber_1 second half)
│   ├── swing-1.wav            # Swing (from saber_2)
│   ├── swing-2.wav            # Swing alt (from task_complete)
│   └── sith-clash.wav         # Dark clash (from job_failed)
├── setup.sh                   # Setup script
├── test-hook.sh               # Test runner
├── README.md
└── .gitignore
```

## Customization

### Replace sounds
Drop your own WAV files into `sounds/` with the same filenames. The hook scripts will pick them up.

### Add new events
Add entries to `hooks/hooks.json` for any supported hook type (see `lib/plugins/types.ts` for the full list).

## Requirements

- macOS (uses `afplay`)

## License

MIT
