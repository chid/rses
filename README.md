# rses

Cross-resume between Claude Code, Codex CLI, and OpenCode sessions. Pick up where one tool left off — in another.

## Install

```bash
npm i -g rsess
```

Requires Node.js 22+.

## Usage

```bash
# Resume in Claude using context from your last Codex session
rses claude with codex --last

# Resume in Codex using context from your last Claude session
rses codex with claude --last

# Resume in OpenCode using context from your last Claude session
rses opencode with claude --last

# Any combination works
rses claude with opencode --last
rses codex with opencode --last
rses opencode with codex --last

# Use a specific session ID
rses claude with codex 019d2406-38f9-7cb2-b912-099b1524e079
rses codex with claude ses_46f04b499ffeE1j9dfy15efgf0
rses claude with opencode ses_3168c88a6ffeE0lFh66PIlcrwB

# Interactive session picker (no ID needed)
rses claude with codex

# Print the handoff without launching (inspect it first)
rses claude with codex --last --dry-run

# Pass flags through to the target tool
rses claude with codex --last --dangerously-skip-permissions --model opus

# Export handoff text to stdout
rses export codex 019d2406-38f9-7cb2-b912-099b1524e079

# List recent sessions
rses ls codex
rses ls claude
rses ls opencode
rses ls                  # all tools

# Filter sessions by working directory
rses ls codex --dir ~/repos/my-project
rses claude with codex --last --dir ~/repos/my-project

# Control how many conversation turns to include (default: 6)
rses claude with codex --last --turns 10
```

## How it works

`rses` reads the source tool's session data, extracts:
- The original task
- Git state since the session started (log + working tree)
- The session file path (so the receiving model can read the full history)
- The last N conversation turns

It builds a structured handoff prompt and launches the target tool with it as the
first message. The receiving model is oriented on turn one — no re-explaining.

## Finding session IDs

```bash
rses ls codex            # list Codex sessions with IDs
rses ls claude           # list Claude sessions with IDs
rses ls opencode         # list OpenCode sessions with IDs
```

Or use the native pickers:
```bash
claude --resume          # Claude's interactive session picker
codex resume             # Codex's interactive session picker
```

## Session storage

| Tool     | Storage |
|----------|---------|
| Claude   | `~/.claude/transcripts/ses_<ID>.jsonl` |
| Codex    | `~/.codex/state_5.sqlite` + `~/.codex/sessions/**/*.jsonl` |
| OpenCode | `~/.local/share/opencode/opencode.db` (SQLite) |

## Flag passthrough

Any flag not recognized by `rses` is forwarded to the target tool:

```bash
rses claude with codex --last --dangerously-skip-permissions
rses codex with claude --last --model o3-pro
rses opencode with claude --last --provider anthropic
```

## Platform support

macOS and Linux. Windows support planned.
