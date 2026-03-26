import { readFileSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'

const TRANSCRIPTS_DIR = join(homedir(), '.claude', 'transcripts')

function extractContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text || '')
      .join('\n')
  }
  return ''
}

export function parseClaudeSession(filePath) {
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim())

  const turns = []

  for (const line of lines) {
    let obj
    try { obj = JSON.parse(line) } catch { continue }

    if (obj.type === 'user') {
      const text = extractContent(obj.content || '')
      if (text) turns.push({ role: 'user', text })
    } else if (obj.type === 'assistant') {
      // assistant content is an array of blocks
      const content = obj.content || []
      const text = Array.isArray(content)
        ? content.filter(c => c.type === 'text').map(c => c.text || '').join('\n')
        : extractContent(content)
      if (text) turns.push({ role: 'assistant', text })
    }
  }

  const sessionId = basename(filePath, '.jsonl').replace(/^ses_/, '')
  const taskTurn = turns.find(t => t.role === 'user')
  const task = taskTurn?.text || ''

  return {
    sessionId,
    cwd: null, // not stored in Claude JSONL
    startCommit: null,
    task,
    turns,
  }
}

export function findClaudeSessions(filterDir = null) {
  let entries
  try { entries = readdirSync(TRANSCRIPTS_DIR) } catch { return [] }

  const sessions = entries
    .filter(f => f.startsWith('ses_') && f.endsWith('.jsonl'))
    .map(f => {
      const path = join(TRANSCRIPTS_DIR, f)
      let mtime = 0
      try { mtime = statSync(path).mtimeMs } catch {}
      return { path, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)

  // Claude JSONL doesn't store CWD, so --dir filtering isn't supported
  // Return all and note the limitation in ls output
  return sessions
}

export function findClaudeSessionById(id) {
  // Accept with or without ses_ prefix
  const normalized = id.startsWith('ses_') ? id : `ses_${id}`
  const path = join(TRANSCRIPTS_DIR, `${normalized}.jsonl`)
  try {
    statSync(path)
    return path
  } catch {
    return null
  }
}

export function getLastClaudeSession(filterDir = null) {
  const sessions = findClaudeSessions(filterDir)
  return sessions[0]?.path || null
}
