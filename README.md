# rses

**Cross-resume between Claude Code, Codex CLI, OpenCode, and Droid.**
Pick up where one AI coding agent left off - in another.

```
rses claude with codex --last
```

That's it. Claude launches with full context from your last Codex session: the original task, git diff, conversation history, and a pointer to the session file for deep-dive.

Works in all 12 directions between Claude Code, Codex CLI, OpenCode, and Droid.

## Install

```bash
npm i -g rses-cli
```

Node.js 22+ required (uses built-in SQLite).

## Quick start

```bash
# You were working in Codex. Now you want Claude to continue.
rses claude with codex --last

# Or the other way around.
rses codex with claude --last

# OpenCode works too — any combination.
rses opencode with codex --last
rses claude with opencode --last

# Droid sessions are supported too.
rses codex with droid --last
rses droid with claude --last
```

## What it does

1. Reads the source tool's session data (JSONL files or SQLite)
2. Extracts: original task, git log since session start, working tree status, last N conversation turns
3. Includes a pointer to the full session file so the receiving model can `Read` it for complete history
4. Launches the target tool with a structured handoff prompt as the first message

The receiving model is oriented on turn one. No re-explaining.

## Commands

### Handoff (main command)

```bash
rses <target> with <source> [session-id] [flags]

# Examples
rses claude with codex --last                    # most recent Codex session
rses codex with claude ses_46f04b499ffe...       # specific Claude session
rses opencode with codex                         # interactive picker
rses droid with codex --last                     # most recent Droid session
rses claude with codex --last --dry-run           # print handoff, don't launch
```

### List sessions

```bash
rses ls                    # all tools
rses ls codex              # just Codex
rses ls claude             # just Claude
rses ls opencode           # just OpenCode
rses ls codex --dir .      # filter by working directory
```

### Export

```bash
rses export codex <id>           # print handoff to stdout
rses export claude <id> --turns 10
```

## Aliases

Power-user shorthand — type less, ship faster:

| Alias | Expands to |
|-------|-----------|
| `cc`, `cl`, `c` | `claude` |
| `cdx`, `cx`, `x` | `codex` |
| `oc`, `o` | `opencode` |
| `d`, `dr` | `droid` |
| `w` | `with` |

```bash
rses cc w cdx --last          # same as: rses claude with codex --last
rses x w oc --last            # same as: rses codex with opencode --last
rses ls cx                    # same as: rses ls codex
```

## Flags

| Flag | Description |
|------|-------------|
| `--last` | Use most recent session (no picker, no ID needed) |
| `--dry-run` | Print the handoff text without launching |
| `--dir <path>` | Filter sessions by working directory |
| `--turns <n>` | Number of conversation turns to include (default: 6) |

**Everything else is passed through to the target tool:**

```bash
rses claude with codex --last --dangerously-skip-permissions --model opus
rses codex with claude --last --model o3-pro
rses opencode with claude --last --provider anthropic
```

## How sessions are read

| Tool | Source | Upgrade-safe |
|------|--------|-------------|
| Claude Code | `~/.claude/transcripts/ses_*.jsonl` | Reads only `user`/`assistant` types |
| Codex CLI | `~/.codex/state_*.sqlite` (auto-discovers version) + JSONL fallback | Handles both 2025 and 2026 schemas |
| OpenCode | `~/.local/share/opencode/opencode.db` | Single JOIN query, reads stable columns only |
| Droid | `~/.factory/sessions/**/*.jsonl` | Reads session metadata plus user/assistant turns, strips system reminders |

All parsers are read-only and wrapped in try/catch — if a tool changes its format, rses degrades gracefully instead of crashing.

## Requirements

- **Node.js 22+** (for built-in `node:sqlite`)
- At least one of: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), [OpenCode](https://github.com/opencode-ai/opencode), [Droid](https://docs.factory.ai/cli/getting-started/overview)
- macOS or Linux (Windows support planned)

## License

MIT
