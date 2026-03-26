import { getGitContext } from './git-context.js'

const TASK_MAX = 800
const TURN_MAX = 600

function trunc(str, max) {
  if (!str) return ''
  str = str.trim()
  if (str.length <= max) return str
  return str.slice(0, max) + '…'
}

export function buildHandoff(source, parsed) {
  const { cwd, uuid, sessionId, startCommit, branch: parsedBranch, task, turns, filePath } = parsed
  const id = uuid || sessionId || 'unknown'
  const TOOL_NAMES = { codex: 'Codex', claude: 'Claude', opencode: 'OpenCode' }
  const toolName = TOOL_NAMES[source] || source

  const lines = []
  lines.push(`=== HANDOFF FROM ${toolName.toUpperCase()} SESSION ${id} ===`)

  if (cwd) lines.push(`CWD: ${cwd}`)

  const git = cwd ? getGitContext(cwd, startCommit) : null
  const branch = git?.branch || parsedBranch || null
  if (branch) lines.push(`Branch: ${branch}`)

  // Always include the session file path — the receiving model can Read it for full context
  if (filePath) {
    lines.push(`Session file: ${filePath}`)
    lines.push(`  (Read this file for the complete conversation history if you need more context)`)
  }

  lines.push('')
  lines.push('Original task:')
  lines.push(`  ${trunc(task, TASK_MAX) || '(not found)'}`)

  if (git) {
    lines.push('')
    if (git.log) {
      lines.push(startCommit ? 'What changed (commits since session started):' : 'Recent commits:')
      git.log.split('\n').forEach(l => lines.push(`  ${l}`))
    }
    if (git.status) {
      lines.push('')
      lines.push('Working tree:')
      git.status.split('\n').forEach(l => lines.push(`  ${l}`))
    }
  }

  if (turns.length) {
    lines.push('')
    lines.push(`Last ${turns.length} messages:`)
    for (const turn of turns) {
      const label = turn.role === 'user' ? 'User' : toolName
      lines.push(`  ${label}: ${trunc(turn.text, TURN_MAX)}`)
    }
  }

  lines.push('')
  const readHint = filePath
    ? ` Read the session file above if you need the full conversation.`
    : ''
  lines.push(`Pick up where ${toolName} left off.${readHint}`)
  lines.push(`=== END HANDOFF ===`)

  return lines.join('\n')
}
